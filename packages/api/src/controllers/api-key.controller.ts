import { http, HttpBody, HttpRequest, HttpAccessDeniedError, HttpBadRequestError } from '@deepkit/http';

import { UxrrConfig } from '../config';
import { UxrrDatabase } from '../database/database';
import { AppEntity } from '../database/entities/app.entity';
import { OidcAuthMiddleware } from '../middleware/oidc-auth.middleware';
import { ApiKeyService } from '../services/api-key.service';

interface CreateApiKeyBody {
    name: string;
    scope: 'readonly' | 'interactive';
    appIds: string[];
}

interface UpdateApiKeyBody {
    name?: string;
    scope?: 'readonly' | 'interactive';
    appIds?: string[];
    isActive?: boolean;
}

interface SignTokenBody {
    exp: number;
    scope: 'readonly' | 'interactive';
    apps: string[];
    sid?: string;
}

interface ApiKeyResponse {
    id: string;
    name: string;
    keyPrefix: string;
    scope: string;
    appIds: string[];
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

@http.controller('v1/api-keys')
export class ApiKeyController {
    constructor(
        private readonly apiKeySvc: ApiKeyService,
        private readonly config: UxrrConfig,
        private readonly db: UxrrDatabase
    ) {}

    @http.POST()
    @http.middleware(OidcAuthMiddleware)
    async createKey(body: HttpBody<CreateApiKeyBody>): Promise<ApiKeyResponse & { key: string }> {
        if (!body.name?.trim()) {
            throw new HttpBadRequestError('API key name is required');
        }
        if (body.appIds.length > 0) {
            await this.validateAppIds(body.appIds);
        }
        const { key, rawKey } = await this.apiKeySvc.create(body.name.trim(), body.scope, body.appIds);
        return { ...this.toResponse(key), key: rawKey };
    }

    @http.GET()
    @http.middleware(OidcAuthMiddleware)
    async listKeys(): Promise<ApiKeyResponse[]> {
        const keys = await this.apiKeySvc.list();
        return keys.map(k => this.toResponse(k));
    }

    @http.GET(':id')
    @http.middleware(OidcAuthMiddleware)
    async getKey(id: string): Promise<ApiKeyResponse> {
        const key = await this.apiKeySvc.get(id);
        return this.toResponse(key);
    }

    @http.PATCH(':id')
    @http.middleware(OidcAuthMiddleware)
    async updateKey(id: string, body: HttpBody<UpdateApiKeyBody>): Promise<ApiKeyResponse> {
        if (body.name !== undefined && !body.name.trim()) {
            throw new HttpBadRequestError('API key name is required');
        }
        if (body.appIds !== undefined && body.appIds.length > 0) {
            await this.validateAppIds(body.appIds);
        }
        const key = await this.apiKeySvc.update(id, body);
        return this.toResponse(key);
    }

    @http.DELETE(':id')
    @http.middleware(OidcAuthMiddleware)
    async revokeKey(id: string): Promise<{ ok: boolean }> {
        await this.apiKeySvc.revoke(id);
        return { ok: true };
    }

    @http.POST('sign')
    async signToken(request: HttpRequest, body: HttpBody<SignTokenBody>): Promise<{ token: string }> {
        const apiKeyHeader = request.headers['x-api-key'] as string | undefined;
        if (!apiKeyHeader) {
            throw new HttpAccessDeniedError('X-API-Key header required');
        }

        const ctx = await this.apiKeySvc.resolveApiKey(apiKeyHeader);
        if (!ctx) {
            throw new HttpAccessDeniedError('Invalid API key');
        }

        if (body.scope === 'interactive' && ctx.scope === 'readonly') {
            throw new HttpAccessDeniedError('Cannot sign interactive token with readonly key');
        }

        // When the key is app-scoped, require non-empty apps and validate each
        if (ctx.appIds.length > 0) {
            if (body.apps.length === 0) {
                throw new HttpBadRequestError('Apps must be specified when API key is app-scoped');
            }
            for (const app of body.apps) {
                if (!ctx.appIds.includes(app)) {
                    throw new HttpAccessDeniedError(`App ${app} not allowed for this key`);
                }
            }
        }

        const now = Math.floor(Date.now() / 1000);
        if (body.exp <= now) {
            throw new HttpBadRequestError('Token expiry must be in the future');
        }
        const maxExp = now + this.config.UXRR_MAX_EMBED_TOKEN_TTL;
        if (body.exp > maxExp) {
            throw new HttpBadRequestError(
                `Token expiry too far in future (max ${this.config.UXRR_MAX_EMBED_TOKEN_TTL}s)`
            );
        }

        const key = await this.apiKeySvc.get(ctx.keyId);
        const token = this.apiKeySvc.signEmbedToken(key, {
            exp: body.exp,
            scope: body.scope,
            apps: body.apps,
            sid: body.sid
        });

        return { token };
    }

    private async validateAppIds(appIds: string[]): Promise<void> {
        const apps = await this.db
            .query(AppEntity)
            .filter({ id: { $in: appIds } })
            .find();
        const foundIds = new Set(apps.map(a => a.id));
        const invalid = appIds.filter(id => !foundIds.has(id));
        if (invalid.length > 0) {
            throw new HttpBadRequestError(`Unknown app IDs: ${invalid.join(', ')}`);
        }
    }

    private toResponse(key: {
        id: string;
        name: string;
        keyPrefix: string;
        scope: string;
        appIds: string[];
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
    }): ApiKeyResponse {
        return {
            id: key.id,
            name: key.name,
            keyPrefix: key.keyPrefix,
            scope: key.scope,
            appIds: key.appIds,
            isActive: key.isActive,
            createdAt: key.createdAt.toISOString(),
            updatedAt: key.updatedAt.toISOString()
        };
    }
}
