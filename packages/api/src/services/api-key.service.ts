import { randomBytes, randomUUID, createHmac, timingSafeEqual } from 'crypto';

import { HttpAccessDeniedError, HttpBadRequestError, HttpNotFoundError } from '@deepkit/http';
import { ScopedLogger } from '@deepkit/logger';
import { Crypto } from '@zyno-io/dk-server-foundation';

import { UxrrDatabase } from '../database/database';
import { ApiKeyEntity } from '../database/entities/api-key.entity';

const CACHE_TTL_MS = 60_000;

export interface EmbedTokenPayload {
    kid: string;
    exp: number;
    scope: 'readonly' | 'interactive';
    apps: string[];
    sid?: string;
}

export interface ApiKeyContext {
    keyId: string;
    scope: 'readonly' | 'interactive';
    appIds: string[];
}

export class ApiKeyService {
    private keyBySecret = new Map<string, ApiKeyEntity>();
    private keyById = new Map<string, ApiKeyEntity>();
    private lastRefresh = 0;
    private refreshPromise?: Promise<void>;

    constructor(
        private readonly db: UxrrDatabase,
        private readonly logger: ScopedLogger
    ) {}

    // ── Management ──────────────────────────────────────────────

    async create(
        name: string,
        scope: 'readonly' | 'interactive',
        appIds: string[]
    ): Promise<{ key: ApiKeyEntity; rawKey: string }> {
        const rawSecret = randomBytes(32).toString('base64url');
        const rawKey = rawSecret;
        const keyPrefix = rawSecret.slice(0, 8);

        const entity = new ApiKeyEntity();
        entity.id = randomUUID();
        entity.name = name;
        entity.keyPrefix = keyPrefix;
        entity.keySecret = Crypto.encrypt(rawKey);
        entity.scope = scope;
        entity.appIds = appIds;
        entity.createdAt = new Date();
        entity.updatedAt = new Date();
        await this.db.persist(entity);

        this.lastRefresh = 0;
        return { key: entity, rawKey };
    }

    async list(): Promise<ApiKeyEntity[]> {
        return this.db.query(ApiKeyEntity).filter({ isActive: true }).sort({ createdAt: 'desc' }).find();
    }

    async get(id: string): Promise<ApiKeyEntity> {
        const key = await this.db.query(ApiKeyEntity).filter({ id }).findOneOrUndefined();
        if (!key) throw new HttpNotFoundError('API key not found');
        return key;
    }

    async update(
        id: string,
        updates: { name?: string; scope?: string; appIds?: string[]; isActive?: boolean }
    ): Promise<ApiKeyEntity> {
        const key = await this.get(id);
        if (updates.name !== undefined) key.name = updates.name;
        if (updates.scope !== undefined) {
            if (updates.scope !== 'readonly' && updates.scope !== 'interactive') {
                throw new HttpBadRequestError('scope must be "readonly" or "interactive"');
            }
            key.scope = updates.scope;
        }
        if (updates.appIds !== undefined) key.appIds = updates.appIds;
        if (updates.isActive !== undefined) key.isActive = updates.isActive;
        key.updatedAt = new Date();
        await this.db.persist(key);
        this.lastRefresh = 0;
        return key;
    }

    async revoke(id: string): Promise<void> {
        const key = await this.get(id);
        key.isActive = false;
        key.updatedAt = new Date();
        await this.db.persist(key);
        this.lastRefresh = 0;
    }

    // ── Direct API key resolution ───────────────────────────────

    async resolveApiKey(rawKey: string): Promise<ApiKeyContext | undefined> {
        await this.ensureFresh();
        const entity = this.keyBySecret.get(rawKey);
        if (!entity || !entity.isActive) return undefined;
        return {
            keyId: entity.id,
            scope: entity.scope as 'readonly' | 'interactive',
            appIds: entity.appIds
        };
    }

    // ── Embed token signing ─────────────────────────────────────

    signEmbedToken(key: ApiKeyEntity, payload: Omit<EmbedTokenPayload, 'kid'>): string {
        const fullPayload: EmbedTokenPayload = { kid: key.id, ...payload };
        const payloadJson = JSON.stringify(fullPayload);
        const payloadB64 = Buffer.from(payloadJson).toString('base64url');
        const rawSecret = Crypto.decrypt(key.keySecret);
        const sig = createHmac('sha256', rawSecret).update(payloadB64).digest('base64url');
        return `${payloadB64}.${sig}`;
    }

    // ── Embed token verification ────────────────────────────────

    async verifyEmbedToken(token: string): Promise<EmbedTokenPayload> {
        const dotIdx = token.indexOf('.');
        if (dotIdx < 0) throw new HttpAccessDeniedError('Invalid embed token');

        const payloadB64 = token.slice(0, dotIdx);
        const sigB64 = token.slice(dotIdx + 1);

        let payload: EmbedTokenPayload;
        try {
            payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
        } catch {
            throw new HttpAccessDeniedError('Invalid embed token');
        }

        // Check expiry before any cache/DB lookup
        if (payload.exp * 1000 < Date.now()) {
            throw new HttpAccessDeniedError('Embed token has expired');
        }

        // Validate scope enum
        if (payload.scope !== 'readonly' && payload.scope !== 'interactive') {
            throw new HttpAccessDeniedError('Invalid embed token scope');
        }

        // Look up key by kid
        await this.ensureFresh();
        const key = this.keyById.get(payload.kid);
        if (!key || !key.isActive) {
            throw new HttpAccessDeniedError('API key not found or inactive');
        }

        // Verify HMAC using decrypted raw key
        const rawSecret = Crypto.decrypt(key.keySecret);
        const expectedSig = createHmac('sha256', rawSecret).update(payloadB64).digest('base64url');
        if (sigB64.length !== expectedSig.length || !timingSafeEqual(Buffer.from(sigB64), Buffer.from(expectedSig))) {
            throw new HttpAccessDeniedError('Invalid embed token');
        }

        // Validate token scope does not exceed key scope
        if (payload.scope === 'interactive' && key.scope === 'readonly') {
            throw new HttpAccessDeniedError('Token scope exceeds key scope');
        }

        // Validate token apps are within key's allowed apps
        if (key.appIds.length > 0 && payload.apps.length > 0) {
            for (const app of payload.apps) {
                if (!key.appIds.includes(app)) {
                    throw new HttpAccessDeniedError('Token app not allowed for this key');
                }
            }
        }

        return payload;
    }

    // ── Cache management ────────────────────────────────────────

    private async ensureFresh(): Promise<void> {
        if (Date.now() - this.lastRefresh < CACHE_TTL_MS) return;
        if (!this.refreshPromise) {
            this.refreshPromise = this.refresh();
        }
        await this.refreshPromise;
    }

    private async refresh(): Promise<void> {
        try {
            const keys = await this.db.query(ApiKeyEntity).filter({ isActive: true }).find();
            const newBySecret = new Map<string, ApiKeyEntity>();
            const newById = new Map<string, ApiKeyEntity>();
            for (const key of keys) {
                newBySecret.set(Crypto.decrypt(key.keySecret), key);
                newById.set(key.id, key);
            }
            this.keyBySecret = newBySecret;
            this.keyById = newById;
            this.lastRefresh = Date.now();
        } catch (err) {
            this.logger.error('Failed to refresh API key cache', err);
        } finally {
            this.refreshPromise = undefined;
        }
    }
}
