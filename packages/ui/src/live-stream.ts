import { createLogger } from './logger';
import { fetchWsToken } from './ws-token';

const log = createLogger('live-stream');

function backoffDelay(attempt: number): number {
    const base = Math.min(1000 * 2 ** attempt, 30_000);
    return base + base * 0.3 * Math.random();
}

export interface AgentInfo {
    id: string;
    email: string;
    name?: string;
    isController: boolean;
}

export interface LiveStreamCallbacks {
    onEvents: (events: unknown[]) => void;
    onLogs: (logs: unknown[]) => void;
    onChat: (message: string, from: string) => void;
    onTyping: () => void;
    onClientConnected: () => void;
    onClientDisconnected: () => void;
    onFocusChange: (focused: boolean) => void;
    onControlGranted: () => void;
    onControlRevoked: () => void;
    onAgentsUpdated: (agents: AgentInfo[]) => void;
    onChatStarted?: () => void;
    onChatEnded?: () => void;
    onPenStart?: (x: number, y: number) => void;
    onPenMove?: (x: number, y: number) => void;
    onPenEnd?: () => void;
}

export interface LiveStreamHandle {
    send: (message: unknown) => void;
    disconnect: () => void;
}

function handleMessage(callbacks: LiveStreamCallbacks, event: MessageEvent): void {
    try {
        const msg = JSON.parse(event.data as string);
        log.log('received message:', msg.type);
        switch (msg.type) {
            case 'events':
                callbacks.onEvents(msg.data);
                break;
            case 'logs':
                callbacks.onLogs(msg.data);
                break;
            case 'chat':
                callbacks.onChat(msg.message, msg.from ?? 'user');
                break;
            case 'typing':
                callbacks.onTyping();
                break;
            case 'focus':
                callbacks.onFocusChange(msg.focused);
                break;
            case 'client_connected':
                callbacks.onClientConnected();
                break;
            case 'client_disconnected':
                callbacks.onClientDisconnected();
                break;
            case 'control_granted':
                callbacks.onControlGranted();
                break;
            case 'control_revoked':
                callbacks.onControlRevoked();
                break;
            case 'agents_updated':
                callbacks.onAgentsUpdated(msg.agents);
                break;
            case 'start_chat':
                callbacks.onChatStarted?.();
                break;
            case 'end_chat':
                callbacks.onChatEnded?.();
                break;
            case 'pen_start':
                callbacks.onPenStart?.(msg.x, msg.y);
                break;
            case 'pen_move':
                callbacks.onPenMove?.(msg.x, msg.y);
                break;
            case 'pen_end':
                callbacks.onPenEnd?.();
                break;
        }
    } catch (err) {
        log.warn('failed to parse live stream message:', err);
    }
}

export function connectLiveSession(sessionId: string, callbacks: LiveStreamCallbacks): LiveStreamHandle {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws: WebSocket;
    let closed = false;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    async function connect() {
        log.log('connecting live session:', sessionId);

        let wsToken: string | undefined;
        try {
            wsToken = await fetchWsToken();
        } catch (err) {
            log.warn('failed to fetch ws token, scheduling reconnect:', err);
            if (!closed) {
                const delay = backoffDelay(reconnectAttempt++);
                reconnectTimer = setTimeout(connect, delay);
            }
            return;
        }

        if (closed) return;

        const tokenParam = wsToken ? `?ws_token=${encodeURIComponent(wsToken)}` : '';
        const url = `${protocol}//${window.location.host}/v1/sessions/${sessionId}/live${tokenParam}`;

        ws = new WebSocket(url);
        ws.onopen = () => {
            log.log(`live[${sessionId}] connected`);
            reconnectAttempt = 0;
        };
        ws.onerror = () => log.error(`live[${sessionId}] error`);
        ws.onmessage = event => handleMessage(callbacks, event);
        ws.onclose = e => {
            log.log(`live[${sessionId}] disconnected, code: ${e.code}, reason: ${e.reason}`);
            if (!closed) {
                const delay = backoffDelay(reconnectAttempt++);
                log.warn(`live[${sessionId}] reconnecting in ${Math.round(delay)}ms`);
                reconnectTimer = setTimeout(connect, delay);
            }
        };
    }

    connect();

    return {
        send(message: unknown) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
            }
        },
        disconnect() {
            log.log('disconnecting live session:', sessionId);
            closed = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            ws.close();
        }
    };
}

export function connectEmbedLiveSession(
    sessionId: string,
    embedToken: string,
    scope: 'readonly' | 'interactive',
    callbacks: LiveStreamCallbacks
): LiveStreamHandle {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws: WebSocket;
    let closed = false;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
        const url = `${protocol}//${window.location.host}/v1/sessions/${sessionId}/live?embed_token=${encodeURIComponent(embedToken)}`;

        log.log('connecting embed live session:', sessionId, 'scope:', scope);
        ws = new WebSocket(url);
        ws.onopen = () => {
            log.log(`embed-live[${sessionId}] connected`);
            reconnectAttempt = 0;
        };
        ws.onerror = () => log.error(`embed-live[${sessionId}] error`);
        ws.onmessage = event => handleMessage(callbacks, event);
        ws.onclose = e => {
            log.log(`embed-live[${sessionId}] disconnected, code: ${e.code}, reason: ${e.reason}`);
            if (!closed) {
                const delay = backoffDelay(reconnectAttempt++);
                log.warn(`embed-live[${sessionId}] reconnecting in ${Math.round(delay)}ms`);
                reconnectTimer = setTimeout(connect, delay);
            }
        };
    }

    connect();

    return {
        send(message: unknown) {
            if (scope === 'readonly') return;
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
            }
        },
        disconnect() {
            log.log('disconnecting embed live session:', sessionId);
            closed = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            ws.close();
        }
    };
}

export function connectSharedLiveSession(token: string, callbacks: LiveStreamCallbacks): LiveStreamHandle {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws: WebSocket;
    let closed = false;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
        const url = `${protocol}//${window.location.host}/v1/shared/${encodeURIComponent(token)}/live`;

        log.log('connecting shared live session');
        ws = new WebSocket(url);
        ws.onopen = () => {
            log.log('shared-live connected');
            reconnectAttempt = 0;
        };
        ws.onerror = () => log.error('shared-live error');
        ws.onmessage = event => handleMessage(callbacks, event);
        ws.onclose = e => {
            log.log(`shared-live disconnected, code: ${e.code}, reason: ${e.reason}`);
            if (!closed) {
                const delay = backoffDelay(reconnectAttempt++);
                log.warn(`shared-live reconnecting in ${Math.round(delay)}ms`);
                reconnectTimer = setTimeout(connect, delay);
            }
        };
    }

    connect();

    return {
        send() {
            // Shared viewers cannot send messages
        },
        disconnect() {
            log.log('disconnecting shared live session');
            closed = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            ws.close();
        }
    };
}
