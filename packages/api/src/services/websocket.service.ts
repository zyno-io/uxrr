import type { IncomingMessage } from 'http';
import type { Socket } from 'net';

import { App, AutoConstruct, ScopedLogger } from '@zyno-io/ts-server-foundation';
import WebSocket from 'ws';

import { UxrrConfig } from '../config';
import { verifyEmbedWsTicket, verifyWsToken } from '../util/ws-token';
import { ApiKeyService } from './api-key.service';
import { AppResolverService } from './app-resolver.service';
import { LiveSessionService } from './live-session.service';
import { OidcService } from './oidc.service';
import { SessionNotifyService } from './session-notify.service';
import { SessionService } from './session.service';
import { ShareService } from './share.service';
import { UserService } from './user.service';

const CLIENT_MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;

/** The embed claims a WebSocket enforces, from `?embed_token=` or from an embed ticket (`?ws_token=`). */
interface EmbedWsClaims {
    scope: 'readonly' | 'interactive';
    apps: string[];
    sid?: string;
}

@AutoConstruct()
export class WebSocketService {
    private readonly devModeAllowed: boolean;

    constructor(
        private readonly app: App,
        private readonly config: UxrrConfig,
        private readonly logger: ScopedLogger,
        private readonly liveSvc: LiveSessionService,
        private readonly appResolver: AppResolverService,
        private readonly oidcSvc: OidcService,
        private readonly notifySvc: SessionNotifyService,
        private readonly shareSvc: ShareService,
        private readonly apiKeySvc: ApiKeyService,
        private readonly sessionSvc: SessionService,
        private readonly userSvc: UserService
    ) {
        this.devModeAllowed = this.config.UXRR_DEV_MODE && process.env.NODE_ENV !== 'production';

        // Client WebSocket — ingest path (large payloads: rrweb event batches)
        const clientWss = new WebSocket.Server({ noServer: true, maxPayload: CLIENT_MAX_PAYLOAD_BYTES });
        // Agent WebSocket — session viewing path (interactive messages)
        const agentWss = new WebSocket.Server({ noServer: true, maxPayload: 256 * 1024 });
        // Session list watcher WebSocket (filter updates only)
        const watchWss = new WebSocket.Server({ noServer: true, maxPayload: 16 * 1024 });

        this.app.http.registerUpgradeHandler((request: IncomingMessage, socket: Socket, head: Buffer) => {
            const url = request.url ?? '';

            const clientMatch = url.match(/^\/v1\/ng\/([^/]+)\/ws/);
            if (clientMatch) {
                this.handleClientUpgrade(clientWss, clientMatch[1], request, socket, head);
                return;
            }

            // Match /v1/sessions/watch before the /v1/sessions/:id/live pattern
            if (url.match(/^\/v1\/sessions\/watch/)) {
                this.handleWatchUpgrade(watchWss, request, socket, head);
                return;
            }

            // Match /v1/shared/:token/live before /v1/sessions/:id/live
            const sharedMatch = url.match(/^\/v1\/shared\/([^/]+)\/live/);
            if (sharedMatch) {
                this.handleSharedViewerUpgrade(agentWss, sharedMatch[1], request, socket, head);
                return;
            }

            const agentMatch = url.match(/^\/v1\/sessions\/([^/]+)\/live/);
            if (agentMatch) {
                this.handleAgentUpgrade(agentWss, agentMatch[1], request, socket, head);
                return;
            }

            // Not our path — destroy the socket
            socket.destroy();
        });

        this.logger.info('WebSocket service initialized');
    }

    private async handleClientUpgrade(
        wss: WebSocket.Server,
        sessionId: string,
        request: IncomingMessage,
        socket: Socket,
        head: Buffer
    ): Promise<void> {
        try {
            // Validate origin/API key (same as HTTP ingest)
            const origin = request.headers['origin'] as string | undefined;
            const apiKey = request.headers['x-api-key'] as string | undefined;

            let resolved: { uuid: string; appKey: string } | undefined;
            if (origin) {
                resolved = await this.appResolver.resolveByOrigin(origin);
            } else if (apiKey) {
                resolved = await this.appResolver.resolveByApiKey(apiKey);
            }

            if (!resolved) {
                socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                socket.destroy();
                return;
            }

            // Validate session-app binding if session already exists
            const existingSession = await this.sessionSvc.getOrThrow(sessionId).catch(() => null);
            if (existingSession && existingSession.appId !== resolved.uuid) {
                socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                socket.destroy();
                return;
            }

            wss.handleUpgrade(request, socket, head, ws => {
                this.guardSocketErrors(ws, 'client', sessionId);
                this.liveSvc.connectClient(sessionId, resolved!.appKey, ws);
            });
        } catch (err) {
            this.logger.error('Client WebSocket upgrade failed', err);
            socket.destroy();
        }
    }

    private async handleAgentUpgrade(
        wss: WebSocket.Server,
        sessionId: string,
        request: IncomingMessage,
        socket: Socket,
        head: Buffer
    ): Promise<void> {
        try {
            const url = new URL(request.url ?? '', `http://${request.headers.host}`);

            let agentEmail = 'agent';
            let agentName: string | undefined;

            // Try ephemeral ws_token first
            const wsToken = url.searchParams.get('ws_token');
            if (wsToken && this.config.UXRR_SHARE_SECRET) {
                // An embed ticket is authorised exactly as the embed token it was minted from
                const ticket = verifyEmbedWsTicket(this.config.UXRR_SHARE_SECRET, wsToken);
                if (ticket) {
                    await this.upgradeEmbedAgent(wss, sessionId, ticket, request, socket, head);
                    return;
                }

                const payload = verifyWsToken(this.config.UXRR_SHARE_SECRET, wsToken);
                if (payload) {
                    if (payload.userId) {
                        const user = await this.userSvc.getById(payload.userId);
                        if (user) {
                            agentEmail = user.email || 'agent';
                            agentName = user.name;
                        }
                    }

                    wss.handleUpgrade(request, socket, head, ws => {
                        this.guardSocketErrors(ws, 'agent', sessionId);
                        if (payload.scope !== 'admin') {
                            this.liveSvc.connectSharedViewer(sessionId, ws);
                        } else {
                            this.liveSvc.connectAgent(sessionId, ws, agentEmail, agentName, payload.userId);
                        }
                    });
                    return;
                }
            }

            // Try embed token (still accepted in the URL for older clients)
            const embedToken = url.searchParams.get('embed_token');
            if (embedToken) {
                let payload: EmbedWsClaims;
                try {
                    payload = await this.apiKeySvc.verifyEmbedToken(embedToken);
                } catch {
                    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                    socket.destroy();
                    return;
                }
                await this.upgradeEmbedAgent(wss, sessionId, payload, request, socket, head);
                return;
            }

            // No OIDC required and no embed token — allow only if dev mode is explicitly enabled
            if (!this.oidcSvc.isEnabled && this.devModeAllowed) {
                wss.handleUpgrade(request, socket, head, ws => {
                    this.guardSocketErrors(ws, 'agent', sessionId);
                    this.liveSvc.connectAgent(sessionId, ws, agentEmail, agentName);
                });
                return;
            }

            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
        } catch (err) {
            this.logger.error('Agent WebSocket upgrade failed', err);
            socket.destroy();
        }
    }

    /** Upgrade a viewer authorised by embed claims: same session, app and scope rules for a token or a ticket. */
    private async upgradeEmbedAgent(
        wss: WebSocket.Server,
        sessionId: string,
        claims: EmbedWsClaims,
        request: IncomingMessage,
        socket: Socket,
        head: Buffer
    ): Promise<void> {
        // Enforce session scope
        if (claims.sid && claims.sid !== sessionId) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
        }

        // Enforce app scope
        if (claims.apps.length > 0) {
            const session = await this.sessionSvc.getOrThrow(sessionId).catch(() => null);
            const sessionAppKey = session ? this.appResolver.resolveAppKey(session.appId) : undefined;
            if (!session || !sessionAppKey || !claims.apps.includes(sessionAppKey)) {
                socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                socket.destroy();
                return;
            }
        }

        wss.handleUpgrade(request, socket, head, ws => {
            this.guardSocketErrors(ws, 'agent', sessionId);
            if (claims.scope === 'interactive') {
                this.liveSvc.connectAgent(sessionId, ws, 'embed-user', 'Embed User');
            } else {
                this.liveSvc.connectSharedViewer(sessionId, ws);
            }
        });
    }

    private async handleSharedViewerUpgrade(
        wss: WebSocket.Server,
        token: string,
        request: IncomingMessage,
        socket: Socket,
        head: Buffer
    ): Promise<void> {
        try {
            // Crypto + DB revocation check
            const sessionId = await this.shareSvc.validateShareAccess(token);

            wss.handleUpgrade(request, socket, head, ws => {
                this.guardSocketErrors(ws, 'shared viewer', sessionId);
                this.liveSvc.connectSharedViewer(sessionId, ws);
            });
        } catch {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
        }
    }

    private async handleWatchUpgrade(wss: WebSocket.Server, request: IncomingMessage, socket: Socket, head: Buffer): Promise<void> {
        try {
            const url = new URL(request.url ?? '', `http://${request.headers.host}`);
            let authenticated = false;

            // Try ephemeral ws_token first: an embed ticket carries the embed token's app restriction
            const wsToken = url.searchParams.get('ws_token');
            let embedPayload: { apps: string[]; sid?: string } | undefined;
            if (wsToken && this.config.UXRR_SHARE_SECRET) {
                const ticket = verifyEmbedWsTicket(this.config.UXRR_SHARE_SECRET, wsToken);
                if (ticket) {
                    embedPayload = ticket;
                    authenticated = true;
                } else if (verifyWsToken(this.config.UXRR_SHARE_SECRET, wsToken)) {
                    authenticated = true;
                }
            }

            // Try embed token (still accepted in the URL for older clients)
            const embedToken = url.searchParams.get('embed_token');
            if (!authenticated && embedToken) {
                try {
                    embedPayload = await this.apiKeySvc.verifyEmbedToken(embedToken);
                    authenticated = true;
                } catch {
                    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                    socket.destroy();
                    return;
                }
            }

            // No auth method succeeded — reject unless dev mode is explicitly enabled
            if (!authenticated && !(this.devModeAllowed && !this.oidcSvc.isEnabled)) {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }

            const filters: {
                appKey?: string;
                userId?: string;
                deviceId?: string;
                from?: string;
                to?: string;
            } = {
                appKey: url.searchParams.get('appKey') || undefined,
                userId: url.searchParams.get('userId') || undefined,
                deviceId: url.searchParams.get('deviceId') || undefined,
                from: url.searchParams.get('from') || undefined,
                to: url.searchParams.get('to') || undefined
            };

            // Enforce app filtering from embed token
            if (embedPayload && embedPayload.apps.length > 0) {
                if (filters.appKey && !embedPayload.apps.includes(filters.appKey)) {
                    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                    socket.destroy();
                    return;
                }
                if (!filters.appKey && embedPayload.apps.length === 1) {
                    filters.appKey = embedPayload.apps[0];
                }
            }

            const allowedAppKeys = embedPayload?.apps;
            // A session-locked embed token or ticket only hears about its own session
            const allowedSessionId = embedPayload?.sid || undefined;
            wss.handleUpgrade(request, socket, head, ws => {
                this.guardSocketErrors(ws, 'session watcher');
                this.notifySvc.addWatcher(ws, filters, allowedAppKeys, allowedSessionId);
            });
        } catch (err) {
            this.logger.error('Watch WebSocket upgrade failed', err);
            socket.destroy();
        }
    }

    private guardSocketErrors(ws: WebSocket, connectionType: string, sessionId?: string): void {
        ws.on('error', error => {
            const socketError = error as Error & { code?: string };
            this.logger.warn(`${connectionType} WebSocket error`, {
                sessionId,
                code: socketError.code,
                error: socketError.message
            });
        });
    }
}
