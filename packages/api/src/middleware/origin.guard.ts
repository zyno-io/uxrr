import { eventDispatcher } from '@deepkit/event';
import { HttpAccessDeniedError, HttpRequest, httpWorkflow } from '@deepkit/http';
import { ScopedLogger } from '@deepkit/logger';

import { AppResolverService } from '../services/app-resolver.service';

/** Resolved app ID, attached to request by the guard */
export const APP_ID_KEY = Symbol('appId');

export function getAppId(request: HttpRequest): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (request as any)[APP_ID_KEY];
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

        let appId: string | undefined;

        if (origin) {
            appId = await this.appResolver.resolveByOrigin(origin);
        } else if (apiKey) {
            appId = await this.appResolver.resolveByApiKey(apiKey);
        }

        if (!appId) {
            this.logger.warn('Ingest rejected: unregistered origin or invalid API key', {
                origin,
                hasApiKey: !!apiKey
            });
            throw new HttpAccessDeniedError('Unregistered origin or invalid API key');
        }

        // attach resolved appId to the request
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (event.request as any)[APP_ID_KEY] = appId;
    }
}
