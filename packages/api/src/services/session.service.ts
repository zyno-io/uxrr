import { HttpNotFoundError } from '@zyno-io/ts-server-foundation';

import { UxrrDatabase } from '../database/database';
import { SessionUserIdEntity } from '../database/entities/session-user-id.entity';
import { SessionEntity } from '../database/entities/session.entity';
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

interface SqlConditions {
    conditions: string[];
    params: unknown[];
    valid: boolean;
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

    async distinctAppKeys(prefix?: string, filters: SessionFilters = {}): Promise<string[]> {
        const { conditions, params, valid } = this.buildSessionConditions(filters);
        if (!valid) return [];

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const rows = await this.db.rawFindUnsafe<{ appId: string }>(`SELECT DISTINCT "appId" FROM "sessions" ${where} LIMIT 200`, params);

        let appKeyResults = rows.map(r => this.appResolver.resolveAppKey(r.appId)).filter(Boolean) as string[];

        if (prefix) {
            const lower = prefix.toLowerCase();
            appKeyResults = appKeyResults.filter(s => s.toLowerCase().startsWith(lower));
        }

        return appKeyResults.sort().slice(0, 50);
    }

    async distinctDeviceIds(prefix?: string, filters: SessionFilters = {}): Promise<string[]> {
        const { conditions, params, valid } = this.buildSessionConditions(filters);
        if (!valid) return [];

        if (prefix) {
            conditions.push(`"deviceId" ILIKE ?`);
            params.push(`${prefix}%`);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const rows = await this.db.rawFindUnsafe<{ deviceId: string }>(
            `SELECT DISTINCT "deviceId" FROM "sessions" ${where} ORDER BY "deviceId" LIMIT 50`,
            params
        );
        return rows.map(r => r.deviceId);
    }

    async distinctUsers(prefix?: string, filters: SessionFilters = {}): Promise<{ userId: string; userName?: string; userEmail?: string }[]> {
        const { conditions, params, valid } = this.buildSessionConditions(filters);
        if (!valid) return [];
        conditions.push(`"userId" IS NOT NULL`);

        if (prefix) {
            conditions.push(`("userId" ILIKE ? OR "userName" ILIKE ? OR "userEmail" ILIKE ?)`);
            params.push(`%${prefix}%`, `%${prefix}%`, `%${prefix}%`);
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

    private buildSessionConditions(filters: SessionFilters): SqlConditions {
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (filters.appKey) {
            const uuid = this.appResolver.resolveAppUuid(filters.appKey);
            if (!uuid) return { conditions, params, valid: false };
            conditions.push(`"appId" = ?`);
            params.push(uuid);
        }

        if (filters.appKeys && filters.appKeys.length > 0) {
            const uuids = filters.appKeys.map(s => this.appResolver.resolveAppUuid(s)).filter(Boolean) as string[];
            if (uuids.length === 0) return { conditions, params, valid: false };
            conditions.push(`"appId" IN (${uuids.map(() => '?').join(', ')})`);
            params.push(...uuids);
        }

        if (filters.userId) {
            conditions.push(
                `EXISTS (SELECT 1 FROM "session_user_ids" WHERE "session_user_ids"."sessionId" = "sessions"."id" AND "session_user_ids"."userId" = ?)`
            );
            params.push(filters.userId);
        }
        if (filters.deviceId) {
            conditions.push(`"deviceId" = ?`);
            params.push(filters.deviceId);
        }
        if (filters.from) {
            conditions.push(`"lastActivityAt" >= ?`);
            params.push(new Date(filters.from));
        }
        if (filters.to) {
            conditions.push(`"startedAt" <= ?`);
            params.push(new Date(filters.to));
        }
        if (filters.hasChat) {
            conditions.push(`"hasChatMessages" = ?`);
            params.push(true);
        }
        if (filters.isLive) {
            conditions.push(`"lastActivityAt" >= ?`);
            params.push(new Date(Date.now() - 30_000));
        }

        return { conditions, params, valid: true };
    }
}
