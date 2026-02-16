import { createHash } from 'crypto';

import { ScopedLogger } from '@deepkit/logger';

import { AppEntity } from '../database/entities/app.entity';
import { UxrrDatabase } from '../database/database';

const CACHE_TTL_MS = 60_000; // 1 minute

export class AppResolverService {
    private originMap = new Map<string, string>(); // origin → appId
    private apiKeyMap = new Map<string, string>(); // apiKey → appId
    private lastRefresh = 0;
    private refreshPromise?: Promise<void>;

    constructor(
        private readonly db: UxrrDatabase,
        private readonly logger: ScopedLogger
    ) {}

    async resolveByOrigin(origin: string): Promise<string | undefined> {
        await this.ensureFresh();
        return this.originMap.get(origin);
    }

    async resolveByApiKey(apiKey: string): Promise<string | undefined> {
        await this.ensureFresh();
        const hash = createHash('sha256').update(apiKey).digest('hex');
        return this.apiKeyMap.get(hash);
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

            const newOriginMap = new Map<string, string>();
            const newApiKeyMap = new Map<string, string>();

            for (const app of apps) {
                for (const origin of app.origins) {
                    newOriginMap.set(origin, app.id);
                }
                if (app.apiKey) {
                    newApiKeyMap.set(app.apiKey, app.id);
                }
            }

            this.originMap = newOriginMap;
            this.apiKeyMap = newApiKeyMap;
            this.lastRefresh = Date.now();
        } catch (err) {
            this.logger.error('Failed to refresh app cache', err);
        } finally {
            this.refreshPromise = undefined;
        }
    }
}
