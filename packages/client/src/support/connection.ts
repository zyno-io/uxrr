import type { SupportOverlay } from './overlay';
import type { SupportChat } from './chat';

interface WsMessage {
    type: string;
    x?: number;
    y?: number;
    message?: string;
    from?: string;
}

export interface SupportCallbacks {
    onAgentConnected?: () => void;
    onAgentDisconnected?: () => void;
    onAnnotation?: (type: 'highlight', x: number, y: number) => void;
    onChat?: (message: string, from: string) => void;
}

export class SupportConnection {
    private ws: WebSocket | null = null;
    private overlay: SupportOverlay | null = null;
    private chat: SupportChat | null = null;
    private onLiveModeChange: ((enabled: boolean) => void) | null = null;
    private onSnapshotRequested: (() => void) | null = null;
    private visibilityHandler: (() => void) | null = null;
    private lastTypingSent = 0;

    constructor(
        private readonly endpoint: string,
        private readonly sessionId: string,
        private readonly renderUI: boolean,
        private readonly callbacks: SupportCallbacks
    ) {}

    get isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    setOnLiveModeChange(fn: (enabled: boolean) => void): void {
        this.onLiveModeChange = fn;
    }

    setOnSnapshotRequested(fn: () => void): void {
        this.onSnapshotRequested = fn;
    }

    async upgrade(): Promise<void> {
        if (this.ws) return;

        const wsUrl = this.endpoint.replace(/^http/, 'ws').replace(/\/$/, '') + `/v1/ng/${this.sessionId}/ws`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            this.callbacks.onAgentConnected?.();
            this.onLiveModeChange?.(true);
            if (this.renderUI) {
                this.initOverlay();
            }
            this.startVisibilityTracking();
        };

        this.ws.onmessage = event => {
            try {
                const msg = JSON.parse(event.data as string);
                this.handleMessage(msg);
            } catch {
                // ignore invalid messages
            }
        };

        this.ws.onclose = () => {
            this.ws = null;
            this.onLiveModeChange?.(false);
            this.callbacks.onAgentDisconnected?.();
            this.destroyUI();
        };
    }

    downgrade(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.onLiveModeChange?.(false);
        this.destroyUI();
    }

    send(message: unknown): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }

    sendEvents(events: unknown[]): void {
        this.send({ type: 'events', data: events });
    }

    sendLogs(logs: unknown[]): void {
        this.send({ type: 'logs', data: logs });
    }

    sendChat(message: string): void {
        this.send({ type: 'chat', message });
    }

    private sendTyping(): void {
        const now = Date.now();
        if (now - this.lastTypingSent < 1000) return;
        this.lastTypingSent = now;
        this.send({ type: 'typing' });
    }

    private async initOverlay(): Promise<void> {
        const { SupportOverlay } = await import('./overlay');
        this.overlay = new SupportOverlay();
    }

    private async initChat(): Promise<void> {
        if (this.chat) return;
        const { SupportChat } = await import('./chat');
        this.chat = new SupportChat(
            msg => this.sendChat(msg),
            () => this.sendTyping(),
            () => {
                this.chat = null;
            }
        );
    }

    private startVisibilityTracking(): void {
        this.visibilityHandler = () => {
            this.send({ type: 'focus', focused: document.visibilityState === 'visible' });
        };
        document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    private stopVisibilityTracking(): void {
        if (this.visibilityHandler) {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
            this.visibilityHandler = null;
        }
    }

    private destroyUI(): void {
        this.stopVisibilityTracking();
        this.overlay?.destroy();
        this.overlay = null;
        this.chat?.setEnabled(false);
    }

    private handleMessage(msg: WsMessage): void {
        switch (msg.type) {
            case 'agent_connected':
                this.callbacks.onAgentConnected?.();
                if (this.renderUI && !this.overlay) {
                    this.initOverlay();
                }
                break;

            case 'agent_disconnected':
                this.callbacks.onAgentDisconnected?.();
                this.downgrade();
                break;

            case 'highlight':
                this.callbacks.onAnnotation?.('highlight', msg.x, msg.y);
                this.overlay?.showHighlight(msg.x, msg.y);
                break;

            case 'cursor':
                this.overlay?.moveCursor(msg.x, msg.y);
                break;

            case 'cursor_hide':
                this.overlay?.hideCursor();
                break;

            case 'remote_click': {
                this.overlay?.showHighlight(msg.x, msg.y);
                const el = document.elementFromPoint(msg.x, msg.y);
                if (el) {
                    const opts: MouseEventInit = {
                        bubbles: true,
                        cancelable: true,
                        clientX: msg.x,
                        clientY: msg.y,
                        view: window
                    };
                    el.dispatchEvent(new MouseEvent('mousedown', opts));
                    el.dispatchEvent(new MouseEvent('mouseup', opts));
                    el.dispatchEvent(new MouseEvent('click', opts));
                }
                break;
            }

            case 'pen_start':
                this.overlay?.penStart(msg.x, msg.y);
                break;

            case 'pen_move':
                this.overlay?.penMove(msg.x, msg.y);
                break;

            case 'pen_end':
                this.overlay?.penEnd();
                break;

            case 'start_chat':
                if (this.renderUI) {
                    if (this.chat) {
                        this.chat.setEnabled(true);
                    } else {
                        this.initChat();
                    }
                }
                break;

            case 'end_chat':
                this.chat?.setEnabled(false);
                break;

            case 'typing':
                this.chat?.showTypingIndicator();
                break;

            case 'chat':
                this.callbacks.onChat?.(msg.message, msg.from);
                if (this.renderUI) {
                    this.initChat().then(() => this.chat?.addMessage(msg.message, msg.from));
                }
                break;

            case 'request_snapshot':
                this.onSnapshotRequested?.();
                break;
        }
    }
}
