import { http, HttpAccessDeniedError, HttpQueries, HttpRequest } from '@deepkit/http';
import { EntityFields } from '@zyno-io/dk-server-foundation';

import { SessionEntity } from '../database/entities/session.entity';
import { SessionAuthMiddleware, getAuthContext } from '../middleware/session-auth.middleware';
import { AppResolverService } from '../services/app-resolver.service';
import { LokiService } from '../services/loki.service';
import { RetentionService } from '../services/retention.service';
import { S3Service } from '../services/s3.service';
import { SessionService } from '../services/session.service';
import { ShareService } from '../services/share.service';

interface SessionQueryParams {
    appKey?: string;
    userId?: string;
    deviceId?: string;
    from?: string;
    to?: string;
    hasChat?: boolean;
    isLive?: boolean;
    before?: string;
    limit?: number;
    offset?: number;
}

type ISession = EntityFields<SessionEntity> & { allUserIds: string[]; isLive: boolean };

export interface ILogEntry {
    t: number;
    v: number;
    c: string;
    m: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Deepkit serializer drops `unknown` fields
    d?: any;
    appKey: string;
    deviceId: string;
    userId?: string;
    sessionId: string;
}

export interface IRrwebEvent {
    type: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Deepkit serializer drops `unknown` fields
    data: any;
    timestamp: number;
    delay?: number;
}

export interface IChatMessage {
    message: string;
    from: string;
    timestamp: number;
}

const LIVE_THRESHOLD_MS = 30_000;

@http.controller('v1/sessions')
@http.middleware(SessionAuthMiddleware)
export class SessionController {
    constructor(
        private readonly sessionSvc: SessionService,
        private readonly s3Svc: S3Service,
        private readonly lokiSvc: LokiService,
        private readonly shareSvc: ShareService,
        private readonly retentionSvc: RetentionService,
        private readonly appResolver: AppResolverService
    ) {}

    @http.GET()
    async listSessions(request: HttpRequest, query: HttpQueries<SessionQueryParams>): Promise<ISession[]> {
        const ctx = getAuthContext(request);
        if (ctx.appKeys) {
            if (query.appKey && !ctx.appKeys.includes(query.appKey)) {
                throw new HttpAccessDeniedError('Access denied for this app');
            }
        }
        const filters = { ...query, appKeys: ctx.appKeys };
        const sessions = await this.sessionSvc.list(filters);
        const userIdMap = await this.sessionSvc.loadAllUserIds(sessions.map(s => s.id));
        return sessions.map(s => this.withIsLive(s, userIdMap.get(s.id) ?? []));
    }

    @http.GET('autocomplete/appKeys')
    async autocompleteAppKeys(request: HttpRequest, query: HttpQueries<{ q?: string }>): Promise<string[]> {
        const ctx = getAuthContext(request);
        return this.sessionSvc.distinctAppKeys(query.q, ctx.appKeys);
    }

    @http.GET('autocomplete/deviceIds')
    async autocompleteDeviceIds(request: HttpRequest, query: HttpQueries<{ q?: string }>): Promise<string[]> {
        const ctx = getAuthContext(request);
        return this.sessionSvc.distinctDeviceIds(query.q, ctx.appKeys);
    }

    @http.GET('autocomplete/users')
    async autocompleteUsers(
        request: HttpRequest,
        query: HttpQueries<{ q?: string }>
    ): Promise<{ userId: string; userName?: string; userEmail?: string }[]> {
        const ctx = getAuthContext(request);
        return this.sessionSvc.distinctUsers(query.q, ctx.appKeys);
    }

    @http.GET(':id')
    async getSession(request: HttpRequest, id: string): Promise<ISession> {
        const session = await this.sessionSvc.getOrThrow(id);
        this.enforceAccess(request, session);
        const userIdMap = await this.sessionSvc.loadAllUserIds([id]);
        return this.withIsLive(session, userIdMap.get(id) ?? []);
    }

    @http.GET(':id/events')
    async getSessionEvents(request: HttpRequest, id: string, query: HttpQueries<{ startChunk?: number; endChunk?: number }>): Promise<IRrwebEvent[]> {
        const session = await this.sessionSvc.getOrThrow(id);
        this.enforceAccess(request, session);
        return this.s3Svc.getEvents(session.appId, id, query.startChunk, query.endChunk) as Promise<IRrwebEvent[]>;
    }

    @http.GET(':id/logs')
    async getSessionLogs(request: HttpRequest, id: string, query: HttpQueries<{ since?: number }>): Promise<ILogEntry[]> {
        const session = await this.sessionSvc.getOrThrow(id);
        this.enforceAccess(request, session);
        const from = query.since ? new Date(query.since) : session.startedAt;
        return this.lokiSvc.queryLogs(session.deviceId, id, from, new Date(session.lastActivityAt.getTime() + 60_000));
    }

    @http.GET(':id/chat')
    async getSessionChat(request: HttpRequest, id: string): Promise<IChatMessage[]> {
        const session = await this.sessionSvc.getOrThrow(id);
        this.enforceAccess(request, session);
        return this.s3Svc.getChat(session.appId, id) as Promise<IChatMessage[]>;
    }

    @http.POST(':id/share')
    async createShareLink(request: HttpRequest, id: string): Promise<{ token: string; expiresAt: string; id: string }> {
        this.requireAdmin(request);
        const result = await this.shareSvc.createShareLink(id);
        return { token: result.token, expiresAt: result.expiresAt.toISOString(), id: result.id };
    }

    @http.DELETE(':id/share')
    async revokeShareLink(request: HttpRequest, id: string): Promise<{ ok: boolean }> {
        this.requireAdmin(request);
        const revoked = await this.shareSvc.revokeActiveLink(id);
        return { ok: revoked };
    }

    @http.DELETE(':id')
    async deleteSession(request: HttpRequest, id: string): Promise<{ ok: true }> {
        this.requireAdmin(request);
        const session = await this.sessionSvc.getOrThrow(id);
        await this.retentionSvc.deleteSessionData(session);
        return { ok: true };
    }

    @http.GET(':id/share')
    async getShareLink(request: HttpRequest, id: string): Promise<{ active: boolean; token?: string; expiresAt?: string; createdAt?: string }> {
        this.requireAdmin(request);
        const link = await this.shareSvc.getActiveLink(id);
        if (!link) return { active: false };
        return {
            active: true,
            token: link.token,
            expiresAt: link.expiresAt.toISOString(),
            createdAt: link.createdAt.toISOString()
        };
    }

    private enforceAccess(request: HttpRequest, session: SessionEntity): void {
        const ctx = getAuthContext(request);
        if (ctx.appKeys) {
            const appKey = this.appResolver.resolveAppKey(session.appId);
            if (!appKey || !ctx.appKeys.includes(appKey)) {
                throw new HttpAccessDeniedError('Access denied for this app');
            }
        }
        if (ctx.sessionId && ctx.sessionId !== session.id) {
            throw new HttpAccessDeniedError('Access denied for this session');
        }
    }

    private requireAdmin(request: HttpRequest): void {
        const ctx = getAuthContext(request);
        if (ctx.scope !== 'admin') {
            throw new HttpAccessDeniedError('Admin access required');
        }
    }

    private withIsLive(session: EntityFields<SessionEntity>, allUserIds: string[]): ISession {
        const isLive = Date.now() - new Date(session.lastActivityAt).getTime() < LIVE_THRESHOLD_MS;
        const appId = this.appResolver.resolveAppKey(session.appId as string) ?? (session.appId as string);
        return { ...session, appId, allUserIds, isLive } as ISession;
    }

    private resolveAppKey(session: SessionEntity): string {
        return this.appResolver.resolveAppKey(session.appId) ?? session.appId;
    }
}
