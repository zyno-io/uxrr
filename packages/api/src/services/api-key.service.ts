import { HttpAccessDeniedError, HttpBadRequestError, HttpNotFoundError } from '@zyno-io/ts-server-foundation';
import { ScopedLogger } from '@zyno-io/ts-server-foundation';
import { Crypto } from '@zyno-io/ts-server-foundation';
import { randomBytes, createHmac, timingSafeEqual } from 'crypto';

import { UxrrConfig } from '../config';
import { UxrrDatabase } from '../database/database';
import { ApiKeyEntity } from '../database/entities/api-key.entity';
import { uuidv7 } from '../util/uuid';

const CACHE_TTL_MS = 60_000;
/** Clock-skew allowance when checking an embed token's lifetime against UXRR_MAX_EMBED_TOKEN_TTL. */
const EMBED_TTL_SKEW_SECS = 60;

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
    appKeys: string[];
}

export class ApiKeyService {
    private keyBySecret = new Map<string, ApiKeyEntity>();
    private keyById = new Map<string, ApiKeyEntity>();
    private lastRefresh = 0;
    private refreshPromise?: Promise<void>;
    private readonly narrowedAppsWarned = new Set<string>();

    constructor(
        private readonly db: UxrrDatabase,
        private readonly logger: ScopedLogger,
        private readonly config: UxrrConfig
    ) {}

    // ── Management ──────────────────────────────────────────────

    async create(name: string, scope: 'readonly' | 'interactive', appKeys: string[]): Promise<{ key: ApiKeyEntity; rawKey: string }> {
        const rawSecret = randomBytes(32).toString('base64url');
        const rawKey = rawSecret;
        const keyPrefix = rawSecret.slice(0, 8);

        const entity = new ApiKeyEntity();
        entity.id = uuidv7();
        entity.name = name;
        entity.keyPrefix = keyPrefix;
        entity.keySecret = Crypto.encrypt(rawKey);
        entity.scope = scope;
        entity.appKeys = appKeys;
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

    async update(id: string, updates: { name?: string; scope?: string; appKeys?: string[]; isActive?: boolean }): Promise<ApiKeyEntity> {
        const key = await this.get(id);
        if (updates.name !== undefined) key.name = updates.name;
        if (updates.scope !== undefined) {
            if (updates.scope !== 'readonly' && updates.scope !== 'interactive') {
                throw new HttpBadRequestError('scope must be "readonly" or "interactive"');
            }
            key.scope = updates.scope;
        }
        if (updates.appKeys !== undefined) key.appKeys = updates.appKeys;
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
            appKeys: entity.appKeys
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

        if (!payload || typeof payload !== 'object') {
            throw new HttpAccessDeniedError('Invalid embed token');
        }

        // Check expiry and lifetime before any cache/DB lookup (self-signed tokens never went through /sign)
        if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
            throw new HttpAccessDeniedError('Embed token has no expiry');
        }
        if (payload.exp * 1000 < Date.now()) {
            throw new HttpAccessDeniedError('Embed token has expired');
        }
        if (payload.exp > Math.floor(Date.now() / 1000) + this.config.UXRR_MAX_EMBED_TOKEN_TTL + EMBED_TTL_SKEW_SECS) {
            throw new HttpAccessDeniedError('Embed token lifetime exceeds the allowed maximum');
        }

        // Validate scope enum
        if (payload.scope !== 'readonly' && payload.scope !== 'interactive') {
            throw new HttpAccessDeniedError('Invalid embed token scope');
        }

        // Validate claim shapes; fail closed rather than let a malformed claim mean "unrestricted"
        if (!Array.isArray(payload.apps) || !payload.apps.every(app => typeof app === 'string')) {
            throw new HttpAccessDeniedError('Invalid embed token');
        }
        if (payload.sid === null || payload.sid === '') {
            // null / empty sid has always meant "no session restriction"
            delete payload.sid;
        } else if (payload.sid !== undefined && typeof payload.sid !== 'string') {
            throw new HttpAccessDeniedError('Invalid embed token');
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
        if (key.appKeys.length > 0 && payload.apps.length > 0) {
            for (const app of payload.apps) {
                if (!key.appKeys.includes(app)) {
                    throw new HttpAccessDeniedError('Token app not allowed for this key');
                }
            }
        } else if (key.appKeys.length > 0) {
            // A self-signed token with no apps must not reach beyond an app-scoped key: it gets the key's apps
            payload.apps = [...key.appKeys];
            if (!this.narrowedAppsWarned.has(key.id)) {
                this.narrowedAppsWarned.add(key.id);
                this.logger.warn('Embed token with no apps narrowed to its app-scoped API key apps', { keyId: key.id });
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
