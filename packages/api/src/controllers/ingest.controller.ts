import { http, HttpBody, HttpRequest, HttpResponse } from '@deepkit/http';
import { HttpAccessDeniedError, HttpBadRequestError, HttpTooManyRequestsError } from '@deepkit/http';
import { ScopedLogger } from '@deepkit/logger';
import { HttpCors } from '@zyno-io/dk-server-foundation/http/cors.js';

import { UxrrConfig } from '../config';
import { getAppId } from '../middleware/origin.guard';
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

    private validateAppId(request: HttpRequest, appId: string): string {
        const decoded = decodeURIComponent(appId);
        const resolvedAppId = getAppId(request);
        if (resolvedAppId !== decoded) {
            this.logger.warn('App ID mismatch', { urlAppId: decoded, resolvedAppId });
            throw new HttpAccessDeniedError('App ID mismatch');
        }
        return decoded;
    }

    @http.POST(':appId/:sessionId/data')
    async ingestData(
        appId: string,
        sessionId: string,
        request: HttpRequest,
        body: HttpBody<IngestDataPayload>
    ): Promise<{ ok: true; ws?: true }> {
        const resolvedAppId = this.validateAppId(request, appId);
        validateSessionId(sessionId);

        const ip = request.socket.remoteAddress ?? 'unknown';
        if (!ingestRateLimiter.isAllowed(ip)) {
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

        const ipAddress = request.socket.remoteAddress;
        await this.ingestSvc.ingestData(resolvedAppId, sessionId, body, ipAddress);
        const result: { ok: true; ws?: true } = { ok: true };
        if (this.liveSvc.isAgentConnected(sessionId)) {
            result.ws = true;
        }
        return result;
    }

    @http.POST(':appId/:sessionId/t')
    async ingestOtlpTraces(
        appId: string,
        sessionId: string,
        request: HttpRequest,
        response: HttpResponse
    ): Promise<void> {
        const resolvedAppId = this.validateAppId(request, appId);
        validateSessionId(sessionId);

        const ip = request.socket.remoteAddress ?? 'unknown';
        if (!otlpRateLimiter.isAllowed(ip)) {
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
        const result = await this.ingestSvc.forwardOtlp('traces', request.body!, contentType, resolvedAppId);
        response.writeHead(result.status, {
            ...HttpCors.getResponseHeaders(response),
            'Content-Type': result.contentType
        });
        response.end(result.body);
    }
}
