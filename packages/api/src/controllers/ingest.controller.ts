import { http, HttpBody, HttpRequest, HttpResponse } from '@deepkit/http';
import { HttpAccessDeniedError, HttpBadRequestError, HttpTooManyRequestsError } from '@deepkit/http';
import { ScopedLogger } from '@deepkit/logger';
import { HttpCors } from '@zyno-io/dk-server-foundation/http/cors.js';

import { UxrrConfig } from '../config';
import { getAppKey, getAppUuid } from '../middleware/origin.guard';
import { IngestService, IngestDataPayload } from '../services/ingest.service';
import { LiveSessionService } from '../services/live-session.service';
import { RateLimiter } from '../util/rate-limiter';
import { validateSessionId } from '../util/validation';

const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5MB
const ingestRateLimiter = new RateLimiter(60, 60_000); // 60 req/min per IP
const otlpRateLimiter = new RateLimiter(30, 60_000); // 30 req/min per IP

@http.controller('v1/ng')
export class IngestController {
    constructor(
        private readonly config: UxrrConfig,
        private readonly ingestSvc: IngestService,
        private readonly liveSvc: LiveSessionService,
        private readonly logger: ScopedLogger
    ) {}

    private validateAppKey(request: HttpRequest, appKey: string): { appKey: string; appUuid: string } {
        const decoded = decodeURIComponent(appKey);
        const resolvedAppKey = getAppKey(request);
        if (resolvedAppKey !== decoded) {
            this.logger.warn('App key mismatch', { urlAppKey: decoded, resolvedAppKey });
            throw new HttpAccessDeniedError('App key mismatch');
        }
        return { appKey: decoded, appUuid: getAppUuid(request) };
    }

    @http.POST(':appKey/:sessionId/data')
    async ingestData(
        appKey: string,
        sessionId: string,
        request: HttpRequest,
        body: HttpBody<IngestDataPayload>
    ): Promise<{ ok: true; ws?: true }> {
        const { appKey: resolvedAppKey, appUuid } = this.validateAppKey(request, appKey);
        validateSessionId(sessionId);

        const ipAddress = request.getRemoteAddress?.() ?? 'unknown';
        if (!ingestRateLimiter.isAllowed(ipAddress)) {
            throw new HttpTooManyRequestsError('Rate limit exceeded');
        }

        if (request.body && request.body.length > MAX_BODY_SIZE) {
            throw new HttpBadRequestError('Payload too large');
        }
        if (body.events && body.events.length > this.config.UXRR_MAX_EVENT_BATCH_SIZE) {
            throw new HttpBadRequestError(`Too many events (max ${this.config.UXRR_MAX_EVENT_BATCH_SIZE})`);
        }
        if (body.logs && body.logs.length > this.config.UXRR_MAX_LOG_BATCH_SIZE) {
            throw new HttpBadRequestError(`Too many logs (max ${this.config.UXRR_MAX_LOG_BATCH_SIZE})`);
        }

        await this.ingestSvc.ingestData(appUuid, resolvedAppKey, sessionId, body, ipAddress);
        const result: { ok: true; ws?: true } = { ok: true };
        if (this.liveSvc.isAgentConnected(sessionId)) {
            result.ws = true;
        }
        return result;
    }

    @http.POST(':appKey/:sessionId/t')
    async ingestOtlpTraces(
        appKey: string,
        sessionId: string,
        request: HttpRequest,
        response: HttpResponse
    ): Promise<void> {
        const { appKey: resolvedAppKey } = this.validateAppKey(request, appKey);
        validateSessionId(sessionId);

        const ipAddress = request.getRemoteAddress?.() ?? 'unknown';
        if (!otlpRateLimiter.isAllowed(ipAddress)) {
            response.writeHead(429, {
                ...HttpCors.getResponseHeaders(response),
                'Content-Type': 'text/plain'
            });
            response.end('Rate limit exceeded');
            return;
        }

        await request.readBody();

        if (request.body && request.body.length > MAX_BODY_SIZE) {
            response.writeHead(413, {
                ...HttpCors.getResponseHeaders(response),
                'Content-Type': 'text/plain'
            });
            response.end('Payload too large');
            return;
        }

        const contentType = request.headers['content-type'] ?? 'application/json';
        const result = await this.ingestSvc.forwardOtlp('traces', request.body!, contentType, resolvedAppKey);
        response.writeHead(result.status, {
            ...HttpCors.getResponseHeaders(response),
            'Content-Type': result.contentType
        });
        response.end(result.body);
    }
}
