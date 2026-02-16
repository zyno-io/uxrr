import { http, HttpQueries } from '@deepkit/http';
import { EntityFields } from '@zyno-io/dk-server-foundation';

import { SessionEntity } from '../database/entities/session.entity';
import { LokiService } from '../services/loki.service';
import { S3Service } from '../services/s3.service';
import { SessionService } from '../services/session.service';
import { ShareService } from '../services/share.service';
import type { IRrwebEvent, ILogEntry, IChatMessage } from './session.controller';

const LIVE_THRESHOLD_MS = 30_000;

type IShareSession = EntityFields<SessionEntity> & { allUserIds: string[]; isLive: boolean };

@http.controller('v1/shared')
export class ShareController {
    constructor(
        private readonly shareSvc: ShareService,
        private readonly sessionSvc: SessionService,
        private readonly s3Svc: S3Service,
        private readonly lokiSvc: LokiService
    ) {}

    private async resolveSession(token: string): Promise<SessionEntity> {
        const sessionId = await this.shareSvc.validateShareAccess(token);
        return this.sessionSvc.getOrThrow(sessionId);
    }

    @http.GET(':token')
    async getSession(token: string): Promise<IShareSession> {
        const session = await this.resolveSession(token);
        const userIdMap = await this.sessionSvc.loadAllUserIds([session.id]);
        const isLive = Date.now() - new Date(session.lastActivityAt).getTime() < LIVE_THRESHOLD_MS;
        return { ...session, allUserIds: userIdMap.get(session.id) ?? [], isLive };
    }

    @http.GET(':token/events')
    async getSessionEvents(token: string): Promise<IRrwebEvent[]> {
        const session = await this.resolveSession(token);
        return this.s3Svc.getEvents(session.appId, session.id) as Promise<IRrwebEvent[]>;
    }

    @http.GET(':token/logs')
    async getSessionLogs(token: string, query: HttpQueries<{ since?: number }>): Promise<ILogEntry[]> {
        const session = await this.resolveSession(token);
        const from = query.since ? new Date(query.since) : session.startedAt;
        return this.lokiSvc.queryLogs(
            session.deviceId,
            session.id,
            from,
            new Date(session.lastActivityAt.getTime() + 60_000)
        );
    }

    @http.GET(':token/chat')
    async getSessionChat(token: string): Promise<IChatMessage[]> {
        const session = await this.resolveSession(token);
        return this.s3Svc.getChat(session.appId, session.id) as Promise<IChatMessage[]>;
    }
}
