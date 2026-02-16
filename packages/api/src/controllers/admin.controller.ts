import { http, HttpBody, HttpRequest, HttpAccessDeniedError, HttpBadRequestError } from '@deepkit/http';
import { HttpUserError } from '@zyno-io/dk-server-foundation';
import { ScopedLogger } from '@deepkit/logger';
import { randomUUID } from 'crypto';

import { UxrrDatabase } from '../database/database';
import { AppEntity } from '../database/entities/app.entity';
import { UserEntity } from '../database/entities/user.entity';
import { OidcAuthMiddleware } from '../middleware/oidc-auth.middleware';
import { getAuthContext } from '../middleware/session-auth.middleware';
import { AppResolverService } from '../services/app-resolver.service';
import { UserService } from '../services/user.service';

interface CreateAppBody {
    id?: string;
    name: string;
    origins: string[];
}

interface UpdateAppBody {
    name?: string;
    origins?: string[];
    isActive?: boolean;
}

interface AppResponse {
    id: string;
    name: string;
    origins: string[];
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

interface UpdateUserBody {
    isAdmin: boolean;
}

interface UserResponse {
    id: string;
    email: string;
    name: string | undefined;
    isAdmin: boolean;
    lastLoginAt: string;
    createdAt: string;
}

@http.controller('v1/admin')
export class AdminController {
    constructor(
        private readonly db: UxrrDatabase,
        private readonly userSvc: UserService,
        private readonly appResolver: AppResolverService,
        private readonly logger: ScopedLogger
    ) {}

    @http.GET('apps')
    @http.middleware(OidcAuthMiddleware)
    async listApps(): Promise<AppResponse[]> {
        const apps = await this.db.query(AppEntity).find();
        return apps.map(a => this.toAppResponse(a));
    }

    @http.POST('apps')
    @http.middleware(OidcAuthMiddleware)
    async createApp(body: HttpBody<CreateAppBody>): Promise<AppResponse> {
        this.validateAppName(body.name);
        this.validateOrigins(body.origins);

        const appId = body.id?.trim() || randomUUID();
        if (body.id) {
            const existing = await this.db.query(AppEntity).filter({ id: appId }).findOneOrUndefined();
            if (existing) {
                throw new HttpUserError(`App ID "${appId}" is already in use`);
            }
        }

        const app = new AppEntity();
        app.id = appId;
        app.name = body.name.trim();
        app.origins = body.origins.map(o => o.trim());
        app.isActive = true;
        app.createdAt = new Date();
        app.updatedAt = new Date();
        await this.db.persist(app);
        this.appResolver.invalidateCache();
        this.logger.info(`App ${app.id} created: ${app.name}`);
        return this.toAppResponse(app);
    }

    @http.PATCH('apps/:id')
    @http.middleware(OidcAuthMiddleware)
    async updateApp(id: string, body: HttpBody<UpdateAppBody>): Promise<AppResponse> {
        if (body.name !== undefined) this.validateAppName(body.name);
        if (body.origins !== undefined) this.validateOrigins(body.origins);

        const app = await this.db.query(AppEntity).filter({ id }).findOne();
        if (body.name !== undefined) app.name = body.name.trim();
        if (body.origins !== undefined) app.origins = body.origins.map(o => o.trim());
        if (body.isActive !== undefined) app.isActive = body.isActive;
        app.updatedAt = new Date();
        await this.db.persist(app);
        this.appResolver.invalidateCache();
        this.logger.info(`App ${id} updated`);
        return this.toAppResponse(app);
    }

    @http.DELETE('apps/:id')
    @http.middleware(OidcAuthMiddleware)
    async deactivateApp(id: string): Promise<{ ok: boolean }> {
        const app = await this.db.query(AppEntity).filter({ id }).findOne();
        app.isActive = false;
        app.updatedAt = new Date();
        await this.db.persist(app);
        this.appResolver.invalidateCache();
        this.logger.info(`App ${id} deactivated`);
        return { ok: true };
    }

    @http.GET('users')
    @http.middleware(OidcAuthMiddleware)
    async listUsers(): Promise<UserResponse[]> {
        const users = await this.userSvc.getAll();
        return users.map(u => this.toUserResponse(u));
    }

    @http.PATCH('users/:id')
    @http.middleware(OidcAuthMiddleware)
    async updateUser(id: string, request: HttpRequest, body: HttpBody<UpdateUserBody>): Promise<UserResponse> {
        const ctx = getAuthContext(request);
        if (ctx.userId === id && !body.isAdmin) {
            throw new HttpAccessDeniedError('Cannot demote yourself');
        }

        // Prevent last-admin lockout
        if (!body.isAdmin) {
            const adminCount = await this.db.query(UserEntity).filter({ isAdmin: true }).count();
            const target = await this.db.query(UserEntity).filter({ id }).findOne();
            if (target.isAdmin && adminCount <= 1) {
                throw new HttpBadRequestError('Cannot demote the last admin');
            }
        }

        const user = await this.userSvc.setAdmin(id, body.isAdmin);
        return this.toUserResponse(user);
    }

    private validateAppName(name: string): void {
        if (!name || !name.trim()) {
            throw new HttpBadRequestError('App name is required');
        }
    }

    private validateOrigins(origins: string[]): void {
        for (const origin of origins) {
            const trimmed = origin.trim();
            if (!trimmed) continue;
            try {
                const url = new URL(trimmed);
                if (url.origin !== trimmed) {
                    throw new HttpBadRequestError(
                        `Invalid origin "${trimmed}": must be scheme + host (e.g. https://example.com)`
                    );
                }
            } catch (err) {
                if (err instanceof HttpBadRequestError) throw err;
                throw new HttpBadRequestError(`Invalid origin "${trimmed}": not a valid URL`);
            }
        }
    }

    private toAppResponse(app: AppEntity): AppResponse {
        return {
            id: app.id,
            name: app.name,
            origins: app.origins,
            isActive: app.isActive,
            createdAt: app.createdAt.toISOString(),
            updatedAt: app.updatedAt.toISOString()
        };
    }

    private toUserResponse(user: {
        id: string;
        email: string;
        name?: string;
        isAdmin: boolean;
        lastLoginAt: Date;
        createdAt: Date;
    }): UserResponse {
        return {
            id: user.id,
            email: user.email,
            name: user.name,
            isAdmin: user.isAdmin,
            lastLoginAt: user.lastLoginAt.toISOString(),
            createdAt: user.createdAt.toISOString()
        };
    }
}
