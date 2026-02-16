import type { Tracer } from '@opentelemetry/api';

export type CaptureMode = 'never' | 'always' | 'onError';

export interface UxrrConfig {
    enabled?: {
        sessions?: boolean;
        logging?: boolean;
        tracing?: boolean;
        support?: boolean;
    };
    endpoint: string;
    appId: string;
    version?: string;
    environment?: string;

    recording?: {
        privacy?: {
            maskInputs?: boolean;
            maskTextContent?: boolean;
            blockSelector?: string;
            consoleLogLevel?: ('log' | 'info' | 'warn' | 'error' | 'debug' | 'assert')[];
        };
    };

    logging?: {
        consolePrefix?: string;
        batchSize?: number;
        flushInterval?: number;
        maxQueueSize?: number;
    };

    tracing?: {
        logRequests?: boolean; // log network requests; default true
        propagateToOrigins?: (string | RegExp)[];
        ignoreUrls?: (string | RegExp)[];
        spanAttributes?: () => Record<string, string>;
        includeRequestHeaders?: CaptureMode;
        includeRequestBody?: CaptureMode;
        includeResponseHeaders?: CaptureMode;
        includeResponseBody?: CaptureMode;
        includeAuthorizationInHeader?: boolean;
        allowListHeaderNames?: string[];
        denyListHeaderNames?: string[];
    };

    support?: {
        renderUI?: boolean;
        onAgentConnected?: () => void;
        onAgentDisconnected?: () => void;
        onAnnotation?: (type: 'highlight', x: number, y: number) => void;
        onChat?: (message: string, from: string) => void;
    };
}

export interface UxrrIdentity {
    deviceId?: string;
    deviceIdPrefix?: string;
    userId?: string;
    userName?: string;
    userEmail?: string;
}

export interface UxrrLogger {
    debug(msg: string, ...args: unknown[]): void;
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
    createScoped(name: string, data?: Record<string, unknown>): UxrrLogger;
}

export interface UxrrInstance {
    readonly sessionId: string;
    readonly tracer: Tracer;
    init(config: UxrrConfig): void;
    identify(identity: UxrrIdentity): void;
    createLogger(scope: string, data?: Record<string, unknown>): UxrrLogger;
    flush(): Promise<void>;
    stop(): void;
}
