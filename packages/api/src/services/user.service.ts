import { ScopedLogger } from '@deepkit/logger';
import { randomUUID } from 'crypto';
import type { JWTPayload } from 'jose';

import { UxrrConfig } from '../config';
import { UxrrDatabase } from '../database/database';
import { UserEntity } from '../database/entities/user.entity';
import { extractOidcScope } from '../util/oidc-scope';

export class UserService {
    constructor(
        private readonly db: UxrrDatabase,
        private readonly config: UxrrConfig,
        private readonly logger: ScopedLogger
    ) {}

    async upsertFromOidc(payload: JWTPayload): Promise<UserEntity> {
        const oidcSub = payload.sub ?? '';
        if (!oidcSub.trim()) {
            throw new Error('OIDC token missing required sub claim');
        }

        const email =
            (payload.email as string) || (payload.preferred_username as string) || (payload.upn as string) || '';
        const name =
            (payload.name as string) ?? (payload.nickname as string) ?? (payload.given_name as string) ?? undefined;

        // Look up by oidcSub (only strategy — no email fallback for security)
        let user = await this.db.query(UserEntity).filter({ oidcSub }).findOneOrUndefined();

        if (user) {
            // Update name/email/lastLoginAt, leave isAdmin untouched
            user.email = email || user.email;
            user.name = name ?? user.name;
            user.lastLoginAt = new Date();
            user.updatedAt = new Date();
            await this.db.persist(user);
            this.logger.debug(`User ${user.id} matched by oidcSub`);
            return user;
        }

        // Create new user
        const totalUsers = await this.db.query(UserEntity).count();
        const isFirstUser = totalUsers === 0;
        const oidcIsAdmin = extractOidcScope(this.config, payload) === 'admin';

        user = new UserEntity();
        user.id = randomUUID();
        user.oidcSub = oidcSub;
        user.email = email;
        user.name = name;
        user.isAdmin = isFirstUser || oidcIsAdmin;
        user.lastLoginAt = new Date();
        user.createdAt = new Date();
        user.updatedAt = new Date();

        try {
            await this.db.persist(user);
        } catch (err: unknown) {
            // Race condition: another request created this user concurrently.
            // Retry the lookup by oidcSub.
            const dbErr = err as { message?: string; code?: string };
            if (dbErr.message?.includes('unique constraint') || dbErr.code === '23505') {
                const existing = await this.db.query(UserEntity).filter({ oidcSub }).findOneOrUndefined();
                if (existing) {
                    this.logger.debug(`User ${existing.id} found on retry after race`);
                    return existing;
                }
            }
            throw err;
        }

        this.logger.info(
            `Created user ${user.id} (email: ${email}, admin: ${user.isAdmin}${isFirstUser ? ', first user' : ''})`
        );
        return user;
    }

    async getAll(): Promise<UserEntity[]> {
        return this.db.query(UserEntity).find();
    }

    async getById(userId: string): Promise<UserEntity | undefined> {
        if (!userId.trim()) return undefined;
        return this.db.query(UserEntity).filter({ id: userId }).findOneOrUndefined();
    }

    async setAdmin(userId: string, isAdmin: boolean): Promise<UserEntity> {
        const user = await this.db.query(UserEntity).filter({ id: userId }).findOne();
        user.isAdmin = isAdmin;
        user.updatedAt = new Date();
        await this.db.persist(user);
        this.logger.info(`User ${userId} admin status set to ${isAdmin}`);
        return user;
    }
}
