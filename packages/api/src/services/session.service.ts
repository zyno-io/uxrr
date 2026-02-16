import { HttpNotFoundError } from '@deepkit/http';

import { SessionUserIdEntity } from '../database/entities/session-user-id.entity';
import { SessionEntity } from '../database/entities/session.entity';
import { UxrrDatabase } from '../database/database';

interface SessionFilters {
    appId?: string;
    appIds?: string[];
    userId?: string;
    deviceId?: string;
    from?: string;
    to?: string;
    hasChat?: boolean;
    limit?: number;
    offset?: number;
}

export class SessionService {
    constructor(private readonly db: UxrrDatabase) {}

    async list(filters: SessionFilters): Promise<SessionEntity[]> {
        let query = this.db.query(SessionEntity);

        if (filters.appId) {
            query = query.filter({ appId: filters.appId });
        }
        if (filters.appIds && filters.appIds.length > 0) {
            query = query.filter({ appId: { $in: filters.appIds } });
        }
        if (filters.userId) {
            const rows = await this.db.rawFindUnsafe<{ sessionId: string }>(
                `SELECT "sessionId" FROM "session_user_ids" WHERE "userId" = ?`,
                [filters.userId]
            );
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

    async distinctAppIds(prefix?: string, appIds?: string[]): Promise<string[]> {
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (prefix) {
            conditions.push(`"appId" ILIKE ?`);
            params.push(`${prefix}%`);
        }
        if (appIds && appIds.length > 0) {
            conditions.push(`"appId" IN (${appIds.map(() => '?').join(', ')})`);
            params.push(...appIds);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const rows = await this.db.rawFindUnsafe<{ appId: string }>(
            `SELECT DISTINCT "appId" FROM "sessions" ${where} ORDER BY "appId" LIMIT 50`,
            params
        );
        return rows.map(r => r.appId);
    }

    async distinctDeviceIds(prefix?: string, appIds?: string[]): Promise<string[]> {
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (prefix) {
            conditions.push(`"deviceId" ILIKE ?`);
            params.push(`${prefix}%`);
        }
        if (appIds && appIds.length > 0) {
            conditions.push(`"appId" IN (${appIds.map(() => '?').join(', ')})`);
            params.push(...appIds);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const rows = await this.db.rawFindUnsafe<{ deviceId: string }>(
            `SELECT DISTINCT "deviceId" FROM "sessions" ${where} ORDER BY "deviceId" LIMIT 50`,
            params
        );
        return rows.map(r => r.deviceId);
    }

    async distinctUsers(
        prefix?: string,
        appIds?: string[]
    ): Promise<{ userId: string; userName?: string; userEmail?: string }[]> {
        const conditions: string[] = [`"userId" IS NOT NULL`];
        const params: unknown[] = [];

        if (prefix) {
            conditions.push(`("userId" ILIKE ? OR "userName" ILIKE ? OR "userEmail" ILIKE ?)`);
            params.push(`%${prefix}%`, `%${prefix}%`, `%${prefix}%`);
        }
        if (appIds && appIds.length > 0) {
            conditions.push(`"appId" IN (${appIds.map(() => '?').join(', ')})`);
            params.push(...appIds);
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
