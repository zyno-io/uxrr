import type { ISession } from '@/openapi-client-generated';

import { getEmbedToken, handleEmbedUnauthorized } from './embed';
import { createLogger } from './logger';
import { EmbedTokenRejectedError, fetchEmbedWsTicket, fetchWsToken } from './ws-token';

const log = createLogger('session-stream');

function backoffDelay(attempt: number): number {
    const base = Math.min(1000 * 2 ** attempt, 30_000);
    return base + base * 0.3 * Math.random();
}

export interface SessionListFilters {
    appKey?: string;
    userId?: string;
    deviceId?: string;
    from?: string;
    to?: string;
}

export interface SessionListStreamCallbacks {
    onSessionCreated: (session: ISession) => void;
    onSessionUpdated: (session: ISession) => void;
    onSessionLiveStatus: (sessionId: string, isLive: boolean, lastActivityAt: string) => void;
    onReconnect?: () => void;
}

export interface SessionListStreamHandle {
    updateFilters: (filters: SessionListFilters) => void;
    disconnect: () => void;
}

export function connectSessionListStream(filters: SessionListFilters, callbacks: SessionListStreamCallbacks): SessionListStreamHandle {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let currentFilters = { ...filters };
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let isFirstConnect = true;
    let reconnectAttempt = 0;

    function buildUrl(wsToken?: string): string {
        const params = new URLSearchParams();
        if (wsToken) params.set('ws_token', wsToken);
        if (currentFilters.appKey) params.set('appKey', currentFilters.appKey);
        if (currentFilters.userId) params.set('userId', currentFilters.userId);
        if (currentFilters.deviceId) params.set('deviceId', currentFilters.deviceId);
        if (currentFilters.from) params.set('from', currentFilters.from);
        if (currentFilters.to) params.set('to', currentFilters.to);
        return `${protocol}//${window.location.host}/v1/sessions/watch?${params.toString()}`;
    }

    async function connect() {
        log.log('connecting session list stream, filters:', currentFilters);

        let wsToken: string | undefined;
        try {
            wsToken = await fetchWsToken();
        } catch (err) {
            log.warn('failed to fetch ws token, scheduling reconnect:', err);
            if (!closed) {
                const delay = backoffDelay(reconnectAttempt++);
                reconnectTimer = setTimeout(() => {
                    connect();
                    if (!isFirstConnect) {
                        callbacks.onReconnect?.();
                    }
                }, delay);
            }
            return;
        }

        if (closed) return;

        ws = new WebSocket(buildUrl(wsToken));

        ws.onopen = () => {
            log.log('session list stream connected');
            reconnectAttempt = 0;
        };

        ws.onmessage = event => {
            try {
                const msg = JSON.parse(event.data as string);
                log.log('session list message:', msg.type, msg.type === 'session_live_status' ? `session=${msg.sessionId} live=${msg.isLive}` : '');
                switch (msg.type) {
                    case 'session_created':
                        callbacks.onSessionCreated(msg.session);
                        break;
                    case 'session_updated':
                        callbacks.onSessionUpdated(msg.session);
                        break;
                    case 'session_live_status':
                        callbacks.onSessionLiveStatus(msg.sessionId, msg.isLive, msg.lastActivityAt);
                        break;
                }
            } catch (err) {
                log.warn('failed to parse session list message:', err);
            }
        };

        ws.onerror = () => log.error('session list stream error');

        ws.onclose = () => {
            if (!closed) {
                const delay = backoffDelay(reconnectAttempt++);
                log.warn(`session list stream disconnected, reconnecting in ${Math.round(delay)}ms`);
                reconnectTimer = setTimeout(() => {
                    connect();
                    if (!isFirstConnect) {
                        callbacks.onReconnect?.();
                    }
                }, delay);
            } else {
                log.log('session list stream closed');
            }
        };

        isFirstConnect = false;
    }

    connect();

    return {
        updateFilters(newFilters: SessionListFilters) {
            currentFilters = { ...newFilters };
            log.log('updating session list stream filters:', currentFilters);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'set_filters', filters: currentFilters }));
            }
        },
        disconnect() {
            log.log('disconnecting session list stream');
            closed = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            ws.close();
        }
    };
}

export function connectEmbedSessionListStream(filters: SessionListFilters, callbacks: SessionListStreamCallbacks): SessionListStreamHandle {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let currentFilters = { ...filters };
    let ws: WebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let isFirstConnect = true;
    let reconnectAttempt = 0;

    // A short-lived ticket when the server can mint one; the embed token itself only for older servers
    function buildUrl(auth: { ws_token: string } | { embed_token: string }): string {
        const params = new URLSearchParams(auth);
        if (currentFilters.appKey) params.set('appKey', currentFilters.appKey);
        if (currentFilters.userId) params.set('userId', currentFilters.userId);
        if (currentFilters.deviceId) params.set('deviceId', currentFilters.deviceId);
        if (currentFilters.from) params.set('from', currentFilters.from);
        if (currentFilters.to) params.set('to', currentFilters.to);
        return `${protocol}//${window.location.host}/v1/sessions/watch?${params.toString()}`;
    }

    function scheduleReconnect() {
        if (closed) return;
        const delay = backoffDelay(reconnectAttempt++);
        log.warn(`embed session list stream disconnected, reconnecting in ${Math.round(delay)}ms`);
        reconnectTimer = setTimeout(() => {
            connect();
            if (!isFirstConnect) {
                callbacks.onReconnect?.();
            }
        }, delay);
    }

    async function connect() {
        log.log('connecting embed session list stream, filters:', currentFilters);
        const embedToken = getEmbedToken();
        if (!embedToken) {
            log.warn('no embed token, not connecting the session list stream');
            return;
        }

        let ticket: string | null;
        try {
            ticket = await fetchEmbedWsTicket(embedToken);
        } catch (err) {
            // a dead token stops here; a 401 before its expiry may be transient and is retried
            if (err instanceof EmbedTokenRejectedError && handleEmbedUnauthorized()) return;
            log.warn('failed to fetch embed ws ticket, scheduling reconnect');
            scheduleReconnect();
            return;
        }

        if (closed) return;

        ws = new WebSocket(buildUrl(ticket ? { ws_token: ticket } : { embed_token: embedToken }));

        ws.onopen = () => {
            log.log('embed session list stream connected');
            reconnectAttempt = 0;
        };

        ws.onmessage = event => {
            try {
                const msg = JSON.parse(event.data as string);
                log.log('embed session list message:', msg.type);
                switch (msg.type) {
                    case 'session_created':
                        callbacks.onSessionCreated(msg.session);
                        break;
                    case 'session_updated':
                        callbacks.onSessionUpdated(msg.session);
                        break;
                    case 'session_live_status':
                        callbacks.onSessionLiveStatus(msg.sessionId, msg.isLive, msg.lastActivityAt);
                        break;
                }
            } catch (err) {
                log.warn('failed to parse embed session list message:', err);
            }
        };

        ws.onerror = () => log.error('embed session list stream error');

        ws.onclose = () => {
            if (!closed) {
                scheduleReconnect();
            } else {
                log.log('embed session list stream closed');
            }
        };

        isFirstConnect = false;
    }

    connect();

    return {
        updateFilters(newFilters: SessionListFilters) {
            currentFilters = { ...newFilters };
            log.log('updating embed session list stream filters:', currentFilters);
            if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'set_filters', filters: currentFilters }));
            }
        },
        disconnect() {
            log.log('disconnecting embed session list stream');
            closed = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            ws?.close();
        }
    };
}
