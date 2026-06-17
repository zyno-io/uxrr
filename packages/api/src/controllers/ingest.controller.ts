import {
    http,
    HttpBody,
    HttpRequest,
    HttpResponse,
    HttpAccessDeniedError,
    HttpGoneError,
    HttpTooManyRequestsError,
    createHttpError
} from '@deepkit/http';
import { ScopedLogger } from '@deepkit/logger';
import { HttpCors } from '@zyno-io/dk-server-foundation/http/cors.js';

import { UxrrConfig } from '../config';
import { UxrrDatabase } from '../database/database';
import { SessionEntity } from '../database/entities/session.entity';
import { getAppKey, getAppUuid, getAppMaxIdleTimeout, getAppMaxSessionDuration } from '../middleware/origin.guard';
import { IngestService, IngestDataPayload } from '../services/ingest.service';
import { LiveSessionService } from '../services/live-session.service';
import { RateLimiter } from '../util/rate-limiter';
import { validateSessionId } from '../util/validation';

const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5MB
const ingestRateLimiter = new RateLimiter(60, 60_000); // 60 req/min per IP
const otlpRateLimiter = new RateLimiter(30, 60_000); // 30 req/min per IP
const HttpPayloadTooLargeError = createHttpError(413, 'Payload too large');

@http.controller('v1/ng')
export class IngestController {
    constructor(
        private readonly config: UxrrConfig,
        private readonly db: UxrrDatabase,
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
    ): Promise<{ ok: true; ws?: true; config?: { maxIdleTimeout?: number; maxSessionDuration?: number } }> {
        const { appKey: resolvedAppKey, appUuid } = this.validateAppKey(request, appKey);
        validateSessionId(sessionId);
        if (body.previousSessionId) {
            validateSessionId(body.previousSessionId);
        }

        const ipAddress = request.getRemoteAddress?.() ?? 'unknown';
        if (!ingestRateLimiter.isAllowed(ipAddress)) {
            throw new HttpTooManyRequestsError('Rate limit exceeded');
        }

        if (request.body && request.body.length > MAX_BODY_SIZE) {
            throw new HttpPayloadTooLargeError('Payload too large');
        }
        if (body.events && body.events.length > this.config.UXRR_MAX_EVENT_BATCH_SIZE) {
            throw new HttpPayloadTooLargeError(`Too many events (max ${this.config.UXRR_MAX_EVENT_BATCH_SIZE})`);
        }
        if (body.logs && body.logs.length > this.config.UXRR_MAX_LOG_BATCH_SIZE) {
            throw new HttpPayloadTooLargeError(`Too many logs (max ${this.config.UXRR_MAX_LOG_BATCH_SIZE})`);
        }

        // Reject events past the idle or total-duration threshold for this session.
        const maxIdleTimeout = getAppMaxIdleTimeout(request);
        const maxSessionDuration = getAppMaxSessionDuration(request);
        if (maxIdleTimeout || maxSessionDuration) {
            const existingSession = await this.db.query(SessionEntity).filter({ id: sessionId }).findOneOrUndefined();
            if (existingSession) {
                const now = Date.now();
                if (maxIdleTimeout && now - existingSession.lastActivityAt.getTime() > maxIdleTimeout) {
                    throw new HttpGoneError('Session exceeded max idle timeout');
                }
                if (maxSessionDuration && now - existingSession.startedAt.getTime() > maxSessionDuration) {
                    throw new HttpGoneError('Session exceeded max session duration');
                }
            }
        }

        await this.ingestSvc.ingestData(appUuid, resolvedAppKey, sessionId, body, ipAddress);
        const result: { ok: true; ws?: true; config?: { maxIdleTimeout?: number; maxSessionDuration?: number } } = { ok: true };
        if (this.liveSvc.isAgentConnected(sessionId)) {
            result.ws = true;
        }
        if (maxIdleTimeout || maxSessionDuration) {
            result.config = {};
            if (maxIdleTimeout) result.config.maxIdleTimeout = maxIdleTimeout;
            if (maxSessionDuration) result.config.maxSessionDuration = maxSessionDuration;
        }
        return result;
    }

    @http.POST(':appKey/:sessionId/t')
    async ingestOtlpTraces(appKey: string, sessionId: string, request: HttpRequest, response: HttpResponse): Promise<void> {
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
