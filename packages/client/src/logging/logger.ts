import { trace } from '@opentelemetry/api';

import type { IngestBuffer } from '../transport/ingest-buffer';
import type { UxrrLogger } from '../types';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_MAP: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
};

const CONSOLE_MAP: Record<LogLevel, (...args: unknown[]) => void> = {
    debug: console.debug.bind(console),
    info: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
};

function normalizeArgs(args: unknown[]): Record<string, unknown> | undefined {
    if (args.length === 0) return undefined;
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !(args[0] instanceof Error)) {
        return args[0] as Record<string, unknown>;
    }
    return { args };
}

export class ScopedLogger implements UxrrLogger {
    constructor(
        private readonly transport: IngestBuffer | undefined,
        private readonly scope: string,
        private readonly consolePrefix: string,
        private readonly scopeData: Record<string, unknown>
    ) {}

    debug(msg: string, ...args: unknown[]): void {
        this.log('debug', msg, args);
    }

    info(msg: string, ...args: unknown[]): void {
        this.log('info', msg, args);
    }

    warn(msg: string, ...args: unknown[]): void {
        this.log('warn', msg, args);
    }

    error(msg: string, ...args: unknown[]): void {
        this.log('error', msg, args);
    }

    createScoped(name: string, data?: Record<string, unknown>): UxrrLogger {
        return new ScopedLogger(this.transport, `${this.scope}/${name}`, `${this.consolePrefix}/${name}`, {
            ...this.scopeData,
            ...data
        });
    }

    private log(level: LogLevel, msg: string, args: unknown[]): void {
        const data = normalizeArgs(args);
        const mergedData = data ? { ...this.scopeData, ...data } : { ...this.scopeData };

        const traceId = trace.getActiveSpan()?.spanContext().traceId;
        if (traceId) {
            mergedData.traceId = traceId;
        }

        const hasData = Object.keys(mergedData).length > 0;

        this.transport?.pushLog({
            t: Date.now(),
            v: LEVEL_MAP[level],
            c: this.scope,
            m: msg,
            d: hasData ? mergedData : undefined
        });

        const consoleFn = CONSOLE_MAP[level];
        if (args.length > 0) {
            consoleFn(`[${this.consolePrefix}]`, msg, ...args);
        } else {
            consoleFn(`[${this.consolePrefix}]`, msg);
        }
    }
}
