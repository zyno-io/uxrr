import { trace } from '@opentelemetry/api';

import type { IngestBuffer } from '../transport/ingest-buffer';
import type { CaptureMode, UxrrConfig } from '../types';

const MAX_BODY_SIZE = 16 * 1024; // 16KB

const TEXT_CONTENT_TYPES = [
    'text/',
    'application/json',
    'application/xml',
    'application/x-www-form-urlencoded',
    'application/graphql',
    'application/javascript'
];

function isTextContentType(contentType: string | null): boolean {
    if (!contentType) return false;
    return TEXT_CONTENT_TYPES.some(t => contentType.includes(t));
}

function shouldCapture(mode: CaptureMode, isError: boolean): boolean {
    if (mode === 'always') return true;
    if (mode === 'onError' && isError) return true;
    return false;
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DEFAULT_SENSITIVE_HEADERS = new Set([
    'authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-auth-token',
    'x-csrf-token',
    'proxy-authorization'
]);

export class NetworkLogger {
    private originalFetch: typeof globalThis.fetch;
    private ignoreUrls: (string | RegExp)[];
    private consolePrefix: string;
    private includeRequestHeaders: CaptureMode;
    private includeRequestBody: CaptureMode;
    private includeResponseHeaders: CaptureMode;
    private includeResponseBody: CaptureMode;
    private includeAuthorizationInHeader: boolean;
    private allowListHeaderNames?: Set<string>;
    private denyListHeaderNames?: Set<string>;

    constructor(
        private readonly ingestBuffer: IngestBuffer,
        config: UxrrConfig
    ) {
        this.originalFetch = globalThis.fetch.bind(globalThis);
        this.ignoreUrls = [...(config.tracing?.ignoreUrls ?? []), new RegExp(escapeRegex(config.endpoint))];

        const prefix = config.logging?.consolePrefix;
        this.consolePrefix = prefix ? `${prefix}:uxrr:net` : 'uxrr:net';

        this.includeRequestHeaders = config.tracing?.includeRequestHeaders ?? 'never';
        this.includeRequestBody = config.tracing?.includeRequestBody ?? 'never';
        this.includeResponseHeaders = config.tracing?.includeResponseHeaders ?? 'never';
        this.includeResponseBody = config.tracing?.includeResponseBody ?? 'never';
        this.includeAuthorizationInHeader = config.tracing?.includeAuthorizationInHeader ?? false;
        this.allowListHeaderNames = config.tracing?.allowListHeaderNames
            ? new Set(config.tracing.allowListHeaderNames.map(n => n.toLowerCase()))
            : undefined;

        const userDenyList = config.tracing?.denyListHeaderNames?.map(n => n.toLowerCase()) ?? [];
        const effectiveSensitive = new Set(DEFAULT_SENSITIVE_HEADERS);
        if (this.includeAuthorizationInHeader) {
            effectiveSensitive.delete('authorization');
        }
        this.denyListHeaderNames = new Set([...effectiveSensitive, ...userDenyList]);

        globalThis.fetch = this.wrappedFetch.bind(this);
    }

    restore(): void {
        globalThis.fetch = this.originalFetch;
    }

    private shouldIgnore(url: string): boolean {
        return this.ignoreUrls.some(pattern => {
            if (typeof pattern === 'string') return url.includes(pattern);
            return pattern.test(url);
        });
    }

    private async wrappedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        const url = input instanceof Request ? input.url : String(input);
        const method = (input instanceof Request ? input.method : (init?.method ?? 'GET')).toUpperCase();

        if (this.shouldIgnore(url)) {
            return this.originalFetch(input, init);
        }

        const startMs = Date.now();

        // Capture traceId eagerly — OTel's span is active in the current context.with() scope
        // but may not survive across await boundaries if Zone.js context is lost.
        const traceId = trace.getActiveSpan()?.spanContext().traceId;

        // Eagerly capture request data (needed for 'onError' mode before we know status)
        const needReqHeaders = this.includeRequestHeaders !== 'never';
        const needReqBody = this.includeRequestBody !== 'never';
        const capturedRequestHeaders = needReqHeaders ? this.captureRequestHeaders(input, init) : undefined;
        const capturedRequestBody = needReqBody ? await this.captureRequestBody(input, init) : undefined;

        let response: Response;
        try {
            response = await this.originalFetch(input, init);
        } catch (err) {
            const duration = Date.now() - startMs;
            this.pushLog(
                method,
                url,
                0,
                duration,
                traceId,
                capturedRequestHeaders,
                capturedRequestBody,
                undefined,
                undefined,
                true
            );
            throw err;
        }

        const duration = Date.now() - startMs;
        const status = response.status;
        const isError = status >= 400;

        // Conditionally include request data based on capture mode + error status
        const requestHeaders = shouldCapture(this.includeRequestHeaders, isError) ? capturedRequestHeaders : undefined;
        const requestBody = shouldCapture(this.includeRequestBody, isError) ? capturedRequestBody : undefined;
        const responseHeaders = shouldCapture(this.includeResponseHeaders, isError)
            ? this.captureResponseHeaders(response)
            : undefined;

        // Response body: clone + read asynchronously to avoid blocking
        if (shouldCapture(this.includeResponseBody, isError)) {
            try {
                const clone = response.clone();
                this.readBodySafe(clone).then(responseBody => {
                    this.pushLog(
                        method,
                        url,
                        status,
                        duration,
                        traceId,
                        requestHeaders,
                        requestBody,
                        responseHeaders,
                        responseBody,
                        isError
                    );
                });
            } catch {
                this.pushLog(
                    method,
                    url,
                    status,
                    duration,
                    traceId,
                    requestHeaders,
                    requestBody,
                    responseHeaders,
                    undefined,
                    isError
                );
            }
        } else {
            this.pushLog(
                method,
                url,
                status,
                duration,
                traceId,
                requestHeaders,
                requestBody,
                responseHeaders,
                undefined,
                isError
            );
        }

        return response;
    }

    private pushLog(
        method: string,
        url: string,
        status: number,
        duration: number,
        traceId: string | undefined,
        requestHeaders?: Record<string, string>,
        requestBody?: string,
        responseHeaders?: Record<string, string>,
        responseBody?: string,
        isError?: boolean
    ): void {
        const d: Record<string, unknown> = { method, url, status, duration };
        if (traceId) d.traceId = traceId;
        if (requestHeaders) d.requestHeaders = requestHeaders;
        if (requestBody !== undefined) d.requestBody = requestBody;
        if (responseHeaders) d.responseHeaders = responseHeaders;
        if (responseBody !== undefined) d.responseBody = responseBody;

        this.ingestBuffer.pushLog({
            t: Date.now() - duration,
            v: isError ? 3 : status >= 400 ? 2 : 0,
            c: 'uxrr:net',
            m: `${method} ${url}`,
            d
        });

        const consoleFn = status >= 400 || isError ? console.warn : console.debug;
        consoleFn(`[${this.consolePrefix}]`, `${method} ${url} ${status || 'ERR'} (${duration}ms)`);
    }

    private captureRequestHeaders(input: RequestInfo | URL, init?: RequestInit): Record<string, string> | undefined {
        let headers: HeadersInit | undefined;

        if (input instanceof Request) {
            headers = input.headers;
        } else {
            headers = init?.headers;
        }

        return this.headersToObject(headers);
    }

    private async captureRequestBody(input: RequestInfo | URL, init?: RequestInit): Promise<string | undefined> {
        let body: BodyInit | null | undefined;

        if (input instanceof Request) {
            try {
                const clone = input.clone();
                const text = await clone.text();
                return this.truncateBody(text);
            } catch {
                return undefined;
            }
        }

        body = init?.body;
        if (body === null || body === undefined) return undefined;

        if (typeof body === 'string') {
            return this.truncateBody(body);
        }
        if (body instanceof URLSearchParams) {
            return this.truncateBody(body.toString());
        }
        if (body instanceof FormData) {
            return '[FormData]';
        }
        if (body instanceof Blob) {
            if (!isTextContentType(body.type) || body.size > MAX_BODY_SIZE) {
                return `[Blob: ${body.type || 'unknown'}, ${body.size} bytes]`;
            }
            try {
                return this.truncateBody(await body.text());
            } catch {
                return `[Blob: ${body.size} bytes]`;
            }
        }
        if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
            const size = body instanceof ArrayBuffer ? body.byteLength : body.byteLength;
            return `[binary: ${size} bytes]`;
        }
        if (body instanceof ReadableStream) {
            return '[ReadableStream]';
        }

        return undefined;
    }

    private captureResponseHeaders(response: Response): Record<string, string> | undefined {
        return this.headersToObject(response.headers);
    }

    private async readBodySafe(response: Response): Promise<string | undefined> {
        const contentType = response.headers.get('content-type');

        if (!isTextContentType(contentType)) {
            const size = response.headers.get('content-length');
            return `[binary: ${contentType || 'unknown'}${size ? `, ${size} bytes` : ''}]`;
        }

        try {
            const text = await response.text();
            return this.truncateBody(text);
        } catch {
            return undefined;
        }
    }

    private truncateBody(text: string): string {
        if (text.length > MAX_BODY_SIZE) {
            return text.slice(0, MAX_BODY_SIZE) + '\n[truncated]';
        }
        return text;
    }

    private headersToObject(headers: HeadersInit | undefined): Record<string, string> | undefined {
        if (!headers) return undefined;

        const result: Record<string, string> = {};

        const addHeader = (key: string, value: string) => {
            const lower = key.toLowerCase();
            if (this.denyListHeaderNames?.has(lower)) {
                result[key] = '[redacted]';
                return;
            }
            if (this.allowListHeaderNames && !this.allowListHeaderNames.has(lower)) return;
            result[key] = value;
        };

        if (headers instanceof Headers) {
            headers.forEach((value, key) => addHeader(key, value));
        } else if (Array.isArray(headers)) {
            for (const [key, value] of headers) {
                addHeader(key, value);
            }
        } else {
            for (const [key, value] of Object.entries(headers)) {
                addHeader(key, value);
            }
        }

        return Object.keys(result).length > 0 ? result : undefined;
    }
}
