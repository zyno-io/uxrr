import { HttpNotFoundError } from '@deepkit/http';

import { SessionUserIdEntity } from '../database/entities/session-user-id.entity';
import { SessionEntity } from '../database/entities/session.entity';
import { UxrrDatabase } from '../database/database';
import { AppResolverService } from './app-resolver.service';

interface SessionFilters {
    appKey?: string;
    appKeys?: string[];
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

export class SessionService {
    constructor(
        private readonly db: UxrrDatabase,
        private readonly appResolver: AppResolverService
    ) {}

    async list(filters: SessionFilters): Promise<SessionEntity[]> {
        let query = this.db.query(SessionEntity);

        if (filters.appKey) {
            const uuid = this.appResolver.resolveAppUuid(filters.appKey);
            if (!uuid) return [];
            query = query.filter({ appId: uuid });
        }
        if (filters.appKeys && filters.appKeys.length > 0) {
            const uuids = filters.appKeys.map(s => this.appResolver.resolveAppUuid(s)).filter(Boolean) as string[];
            if (uuids.length === 0) return [];
            query = query.filter({ appId: { $in: uuids } });
        }
        if (filters.userId) {
            const rows = await this.db.rawFindUnsafe<{ sessionId: string }>(`SELECT "sessionId" FROM "session_user_ids" WHERE "userId" = ?`, [
                filters.userId
            ]);
            const ids = rows.map(r => r.sessionId);
            if (ids.length === 0) return [];
            query = query.filter({ id: { $in: ids } });
        }
        if (filters.deviceId) {
            query = query.filter({ deviceId: filters.deviceId });
        }
        if (filters.from) {
            query = query.filter({ lastActivityAt: { $gte: new Date(filters.from) } });
        }
        if (filters.to) {
            query = query.filter({ startedAt: { $lte: new Date(filters.to) } });
        }
        if (filters.hasChat) {
            query = query.filter({ hasChatMessages: true });
        }
        if (filters.isLive) {
            query = query.filter({ lastActivityAt: { $gte: new Date(Date.now() - 30_000) } });
        }

        if (filters.before) {
            const ref = await this.db.query(SessionEntity).filter({ id: filters.before }).findOneOrUndefined();
            if (ref) {
                query = query.filter({ startedAt: { $lt: ref.startedAt } });
            }
        }

        query = query.sort({ startedAt: 'desc' });

        if (filters.offset) {
            query = query.skip(filters.offset);
        }

        query = query.limit(Math.min(filters.limit ?? 50, 200));

        return query.find();
    }

    async getOrThrow(id: string): Promise<SessionEntity> {
        const session = await this.db.query(SessionEntity).filter({ id }).findOneOrUndefined();
        if (!session) {
            throw new HttpNotFoundError(`Session ${id} not found`);
        }
        return session;
    }

    async deleteSession(id: string): Promise<SessionEntity> {
        const session = await this.getOrThrow(id);
        await this.db.query(SessionUserIdEntity).filter({ sessionId: id }).deleteMany();
        await this.db.query(SessionEntity).filter({ id }).deleteOne();
        return session;
    }

    async loadAllUserIds(sessionIds: string[]): Promise<Map<string, string[]>> {
        if (sessionIds.length === 0) return new Map();
        const placeholders = sessionIds.map(() => '?').join(', ');
        const rows = await this.db.rawFindUnsafe<{ sessionId: string; userId: string }>(
            `SELECT "sessionId", "userId" FROM "session_user_ids" WHERE "sessionId" IN (${placeholders})`,
            sessionIds
        );
        const map = new Map<string, string[]>();
        for (const row of rows) {
            const list = map.get(row.sessionId);
            if (list) {
                list.push(row.userId);
            } else {
                map.set(row.sessionId, [row.userId]);
            }
        }
        return map;
    }

    async distinctAppKeys(prefix?: string, appKeys?: string[]): Promise<string[]> {
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (appKeys && appKeys.length > 0) {
            const uuids = appKeys.map(s => this.appResolver.resolveAppUuid(s)).filter(Boolean) as string[];
            if (uuids.length === 0) return [];
            conditions.push(`"appId" IN (${uuids.map(() => '?').join(', ')})`);
            params.push(...uuids);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const rows = await this.db.rawFindUnsafe<{ appId: string }>(`SELECT DISTINCT "appId" FROM "sessions" ${where} LIMIT 200`, params);

        let appKeyResults = rows.map(r => this.appResolver.resolveAppKey(r.appId)).filter(Boolean) as string[];

        if (prefix) {
            const lower = prefix.toLowerCase();
            appKeyResults = appKeyResults.filter(s => s.toLowerCase().startsWith(lower));
        }

        return appKeyResults.sort().slice(0, 50);
    }

    private resolveAppUuids(appKeys?: string[]): string[] | undefined {
        if (!appKeys || appKeys.length === 0) return undefined;
        const uuids = appKeys.map(s => this.appResolver.resolveAppUuid(s)).filter(Boolean) as string[];
        return uuids.length > 0 ? uuids : undefined;
    }

    async distinctDeviceIds(prefix?: string, appKeys?: string[]): Promise<string[]> {
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (prefix) {
            conditions.push(`"deviceId" ILIKE ?`);
            params.push(`${prefix}%`);
        }
        const uuids = this.resolveAppUuids(appKeys);
        if (appKeys && appKeys.length > 0 && !uuids) return [];
        if (uuids) {
            conditions.push(`"appId" IN (${uuids.map(() => '?').join(', ')})`);
            params.push(...uuids);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const rows = await this.db.rawFindUnsafe<{ deviceId: string }>(
            `SELECT DISTINCT "deviceId" FROM "sessions" ${where} ORDER BY "deviceId" LIMIT 50`,
            params
        );
        return rows.map(r => r.deviceId);
    }

    async distinctUsers(prefix?: string, appKeys?: string[]): Promise<{ userId: string; userName?: string; userEmail?: string }[]> {
        const conditions: string[] = [`"userId" IS NOT NULL`];
        const params: unknown[] = [];

        if (prefix) {
            conditions.push(`("userId" ILIKE ? OR "userName" ILIKE ? OR "userEmail" ILIKE ?)`);
            params.push(`%${prefix}%`, `%${prefix}%`, `%${prefix}%`);
        }
        const uuids = this.resolveAppUuids(appKeys);
        if (appKeys && appKeys.length > 0 && !uuids) return [];
        if (uuids) {
            conditions.push(`"appId" IN (${uuids.map(() => '?').join(', ')})`);
            params.push(...uuids);
        }

        const where = `WHERE ${conditions.join(' AND ')}`;
        const rows = await this.db.rawFindUnsafe<{ userId: string; userName: string | null; userEmail: string | null }>(
            `SELECT DISTINCT ON ("userId") "userId", "userName", "userEmail" FROM "sessions" ${where} ORDER BY "userId" LIMIT 50`,
            params
        );
        return rows.map(r => ({
            userId: r.userId,
            userName: r.userName ?? undefined,
            userEmail: r.userEmail ?? undefined
        }));
    }
}
