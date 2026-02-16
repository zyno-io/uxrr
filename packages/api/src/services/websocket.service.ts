import { ApplicationServer } from '@deepkit/framework';
import { ScopedLogger } from '@deepkit/logger';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import WebSocket from 'ws';

import { AutoStart, resolve } from '@zyno-io/dk-server-foundation';

import { UxrrConfig } from '../config';
import { verifyWsToken } from '../util/ws-token';
import { ApiKeyService } from './api-key.service';
import { AppResolverService } from './app-resolver.service';
import { LiveSessionService } from './live-session.service';
import { OidcService } from './oidc.service';
import { SessionNotifyService } from './session-notify.service';
import { SessionService } from './session.service';
import { ShareService } from './share.service';
import { UserService } from './user.service';

@AutoStart()
export class WebSocketService {
    private readonly devModeAllowed: boolean;

    constructor(
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
        const app = resolve(ApplicationServer);
        const httpServer = (app.getHttpWorker() as unknown as { server: import('http').Server })['server'];

        // Client WebSocket — ingest path (large payloads: rrweb event batches)
        const clientWss = new WebSocket.Server({ noServer: true, maxPayload: 1024 * 1024 });
        // Agent WebSocket — session viewing path (interactive messages)
        const agentWss = new WebSocket.Server({ noServer: true, maxPayload: 256 * 1024 });
        // Session list watcher WebSocket (filter updates only)
        const watchWss = new WebSocket.Server({ noServer: true, maxPayload: 16 * 1024 });

        httpServer.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
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

        this.notifySvc.startStaleChecker();
        this.logger.info('WebSocket service initialized');
    }

    private async handleClientUpgrade(
        wss: WebSocket.Server,
        sessionId: string,
        request: IncomingMessage,
        socket: Duplex,
        head: Buffer
    ): Promise<void> {
        try {
            // Validate origin/API key (same as HTTP ingest)
            const origin = request.headers['origin'] as string | undefined;
            const apiKey = request.headers['x-api-key'] as string | undefined;

            let appId: string | undefined;
            if (origin) {
                appId = await this.appResolver.resolveByOrigin(origin);
            } else if (apiKey) {
                appId = await this.appResolver.resolveByApiKey(apiKey);
            }

            if (!appId) {
                socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                socket.destroy();
                return;
            }

            // Validate session-app binding if session already exists
            const existingSession = await this.sessionSvc.getOrThrow(sessionId).catch(() => null);
            if (existingSession && existingSession.appId !== appId) {
                socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                socket.destroy();
                return;
            }

            wss.handleUpgrade(request, socket, head, ws => {
                this.liveSvc.connectClient(sessionId, appId!, ws);
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
        socket: Duplex,
        head: Buffer
    ): Promise<void> {
        try {
            const url = new URL(request.url ?? '', `http://${request.headers.host}`);

            let agentEmail = 'agent';
            let agentName: string | undefined;

            // Try ephemeral ws_token first
            const wsToken = url.searchParams.get('ws_token');
            if (wsToken && this.config.UXRR_SHARE_SECRET) {
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
                        if (payload.scope !== 'admin') {
                            this.liveSvc.connectSharedViewer(sessionId, ws);
                        } else {
                            this.liveSvc.connectAgent(sessionId, ws, agentEmail, agentName, payload.userId);
                        }
                    });
                    return;
                }
            }

            // Try embed token
            const embedToken = url.searchParams.get('embed_token');
            if (embedToken) {
                try {
                    const payload = await this.apiKeySvc.verifyEmbedToken(embedToken);

                    // Enforce session scope
                    if (payload.sid && payload.sid !== sessionId) {
                        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                        socket.destroy();
                        return;
                    }

                    // Enforce app scope
                    if (payload.apps.length > 0) {
                        const session = await this.sessionSvc.getOrThrow(sessionId).catch(() => null);
                        if (!session || !payload.apps.includes(session.appId)) {
                            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                            socket.destroy();
                            return;
                        }
                    }

                    wss.handleUpgrade(request, socket, head, ws => {
                        if (payload.scope === 'interactive') {
                            this.liveSvc.connectAgent(sessionId, ws, 'embed-user', 'Embed User');
                        } else {
                            this.liveSvc.connectSharedViewer(sessionId, ws);
                        }
                    });
                    return;
                } catch {
                    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                    socket.destroy();
                    return;
                }
            }

            // No OIDC required and no embed token — allow only if dev mode is explicitly enabled
            if (!this.oidcSvc.isEnabled && this.devModeAllowed) {
                wss.handleUpgrade(request, socket, head, ws => {
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

    private async handleSharedViewerUpgrade(
        wss: WebSocket.Server,
        token: string,
        request: IncomingMessage,
        socket: Duplex,
        head: Buffer
    ): Promise<void> {
        try {
            // Crypto + DB revocation check
            const sessionId = await this.shareSvc.validateShareAccess(token);

            wss.handleUpgrade(request, socket, head, ws => {
                this.liveSvc.connectSharedViewer(sessionId, ws);
            });
        } catch {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
        }
    }

    private async handleWatchUpgrade(
        wss: WebSocket.Server,
        request: IncomingMessage,
        socket: Duplex,
        head: Buffer
    ): Promise<void> {
        try {
            const url = new URL(request.url ?? '', `http://${request.headers.host}`);
            let authenticated = false;

            // Try ephemeral ws_token first
            const wsToken = url.searchParams.get('ws_token');
            if (wsToken && this.config.UXRR_SHARE_SECRET) {
                const payload = verifyWsToken(this.config.UXRR_SHARE_SECRET, wsToken);
                if (payload) authenticated = true;
            }

            // Try embed token
            const embedToken = url.searchParams.get('embed_token');
            let embedPayload: { apps: string[] } | undefined;
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
                appId?: string;
                userId?: string;
                deviceId?: string;
                from?: string;
                to?: string;
            } = {
                appId: url.searchParams.get('appId') || undefined,
                userId: url.searchParams.get('userId') || undefined,
                deviceId: url.searchParams.get('deviceId') || undefined,
                from: url.searchParams.get('from') || undefined,
                to: url.searchParams.get('to') || undefined
            };

            // Enforce app filtering from embed token
            if (embedPayload && embedPayload.apps.length > 0) {
                if (filters.appId && !embedPayload.apps.includes(filters.appId)) {
                    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                    socket.destroy();
                    return;
                }
                if (!filters.appId && embedPayload.apps.length === 1) {
                    filters.appId = embedPayload.apps[0];
                }
            }

            const allowedAppIds = embedPayload?.apps;
            wss.handleUpgrade(request, socket, head, ws => {
                this.notifySvc.addWatcher(ws, filters, allowedAppIds);
            });
        } catch (err) {
            this.logger.error('Watch WebSocket upgrade failed', err);
            socket.destroy();
        }
    }
}
