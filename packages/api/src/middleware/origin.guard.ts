import { eventDispatcher } from '@deepkit/event';
import { HttpAccessDeniedError, HttpRequest, httpWorkflow } from '@deepkit/http';
import { ScopedLogger } from '@deepkit/logger';

import { AppResolverService, ResolvedApp } from '../services/app-resolver.service';

/** Resolved app key (human-readable), attached to request by the guard */
export const APP_KEY_KEY = Symbol('appKey');
/** Resolved app UUID (database PK), attached to request by the guard */
export const APP_UUID_KEY = Symbol('appUuid');

export function getAppKey(request: HttpRequest): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (request as any)[APP_KEY_KEY];
}

export function getAppUuid(request: HttpRequest): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (request as any)[APP_UUID_KEY];
}

export class AppGuard {
    constructor(
        private readonly appResolver: AppResolverService,
        private readonly logger: ScopedLogger
    ) {}

    @eventDispatcher.listen(httpWorkflow.onController, 50)
    async onController(event: typeof httpWorkflow.onController.event): Promise<void> {
        if (event.sent) return;

        const url = event.request.url ?? '';
        if (!url.startsWith('/v1/ng')) return;

        const origin = event.request.headers['origin'] as string | undefined;
        const apiKey = event.request.headers['x-api-key'] as string | undefined;

        let resolved: ResolvedApp | undefined;

        if (origin) {
            resolved = await this.appResolver.resolveByOrigin(origin);
        } else if (apiKey) {
            resolved = await this.appResolver.resolveByApiKey(apiKey);
        }

        if (!resolved) {
            this.logger.warn('Ingest rejected: unregistered origin or invalid API key', {
                origin,
                hasApiKey: !!apiKey
            });
            throw new HttpAccessDeniedError('Unregistered origin or invalid API key');
        }

        // attach resolved app to the request
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (event.request as any)[APP_KEY_KEY] = resolved.appKey;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (event.request as any)[APP_UUID_KEY] = resolved.uuid;
    }
}
