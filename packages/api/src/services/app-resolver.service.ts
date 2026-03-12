import { createHash } from 'crypto';

import { ScopedLogger } from '@deepkit/logger';

import { AppEntity } from '../database/entities/app.entity';
import { UxrrDatabase } from '../database/database';

const CACHE_TTL_MS = 60_000; // 1 minute

export interface ResolvedApp {
    uuid: string;
    appKey: string;
    maxIdleTimeout?: number;
}

export class AppResolverService {
    private originMap = new Map<string, ResolvedApp>(); // origin → resolved
    private apiKeyMap = new Map<string, ResolvedApp>(); // hashedApiKey → resolved
    private appKeyToUuid = new Map<string, string>(); // appKey → uuid
    private uuidToAppKey = new Map<string, string>(); // uuid → appKey

    private lastRefresh = 0;
    private refreshPromise?: Promise<void>;

    constructor(
        private readonly db: UxrrDatabase,
        private readonly logger: ScopedLogger
    ) {}

    async resolveByOrigin(origin: string): Promise<ResolvedApp | undefined> {
        await this.ensureFresh();
        return this.originMap.get(origin);
    }

    async resolveByApiKey(apiKey: string): Promise<ResolvedApp | undefined> {
        await this.ensureFresh();
        const hash = createHash('sha256').update(apiKey).digest('hex');
        return this.apiKeyMap.get(hash);
    }

    /** Synchronous appKey → UUID lookup (from in-memory cache). */
    resolveAppUuid(appKey: string): string | undefined {
        return this.appKeyToUuid.get(appKey);
    }

    /** Synchronous UUID → appKey lookup (from in-memory cache). */
    resolveAppKey(uuid: string): string | undefined {
        return this.uuidToAppKey.get(uuid);
    }

    async getAllowedOrigins(): Promise<string[]> {
        await this.ensureFresh();
        return [...this.originMap.keys()];
    }

    invalidateCache(): void {
        // Force refresh on next lookup after app/admin mutations.
        this.lastRefresh = 0;
    }

    private async ensureFresh(): Promise<void> {
        if (Date.now() - this.lastRefresh < CACHE_TTL_MS) return;

        // coalesce concurrent refreshes
        if (!this.refreshPromise) {
            this.refreshPromise = this.refresh();
        }
        await this.refreshPromise;
    }

    private async refresh(): Promise<void> {
        try {
            const apps = await this.db.query(AppEntity).filter({ isActive: true }).find();

            const newOriginMap = new Map<string, ResolvedApp>();
            const newApiKeyMap = new Map<string, ResolvedApp>();
            const newAppKeyToUuid = new Map<string, string>();
            const newUuidToAppKey = new Map<string, string>();

            for (const app of apps) {
                const resolved: ResolvedApp = { uuid: app.id, appKey: app.appKey, maxIdleTimeout: app.maxIdleTimeout };
                newAppKeyToUuid.set(app.appKey, app.id);
                newUuidToAppKey.set(app.id, app.appKey);

                for (const origin of app.origins) {
                    newOriginMap.set(origin, resolved);
                }
                if (app.apiKey) {
                    newApiKeyMap.set(app.apiKey, resolved);
                }
            }

            this.originMap = newOriginMap;
            this.apiKeyMap = newApiKeyMap;
            this.appKeyToUuid = newAppKeyToUuid;
            this.uuidToAppKey = newUuidToAppKey;
            this.lastRefresh = Date.now();
        } catch (err) {
            this.logger.error('Failed to refresh app cache', err);
        } finally {
            this.refreshPromise = undefined;
        }
    }
}
