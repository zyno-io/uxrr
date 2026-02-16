import type { Tracer } from '@opentelemetry/api';
import { trace } from '@opentelemetry/api';

import { IdentityManager } from './identity';
import { NavigationLogger } from './logging/navigation';
import { ScopedLogger } from './logging/logger';
import { Recorder } from './recording/recorder';
import { SessionManager } from './session';
import { SupportConnection } from './support/connection';
import { FlushCoordinator } from './transport/flush';
import { HttpTransport } from './transport/http';
import { IngestBuffer } from './transport/ingest-buffer';
import { TracingProvider } from './tracing/provider';
import type { UxrrConfig, UxrrIdentity, UxrrInstance, UxrrLogger } from './types';

let _activeTracer: Tracer = trace.getTracer('uxrr');
let _uxrr: UXRR | undefined;

export const tracer: Tracer = new Proxy({} as Tracer, {
    get(_, prop) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const value = (_activeTracer as any)[prop];
        return typeof value === 'function' ? value.bind(_activeTracer) : value;
    }
});

function getOrCreateInstance(): UXRR {
    if (!_uxrr) _uxrr = new UXRR();
    return _uxrr;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const uxrr: UxrrInstance = new Proxy({} as UxrrInstance, {
    get(_, prop) {
        const instance = getOrCreateInstance();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const value = (instance as any)[prop];
        return typeof value === 'function' ? value.bind(instance) : value;
    }
});

class UXRR implements UxrrInstance {
    readonly sessionId: string;
    tracer: Tracer;

    private readonly identity: IdentityManager;
    private readonly session: SessionManager;
    private consolePrefix = '';
    private transport: HttpTransport | undefined;
    private flushCoordinator: FlushCoordinator | undefined;
    private ingestBuffer: IngestBuffer | undefined;
    private recorder: Recorder | undefined;
    private tracingProvider: TracingProvider | undefined;
    private supportConnection: SupportConnection | undefined;
    private navigationLogger: NavigationLogger | undefined;
    private boundFlushFn: (() => void) | undefined;

    constructor() {
        this.identity = new IdentityManager();
        this.session = new SessionManager();
        this.sessionId = this.session.sessionId;
        this.tracer = trace.getTracer('uxrr');
    }

    init(config: UxrrConfig): void {
        // Tear down previous subsystems on re-init
        if (this.ingestBuffer || this.recorder || this.tracingProvider || this.supportConnection) {
            this.stop();
        }

        const enabled = config.enabled ?? {};
        const sessionsEnabled = enabled.sessions !== false;
        const loggingEnabled = enabled.logging !== false;
        const tracingEnabled = enabled.tracing !== false;
        const supportEnabled = enabled.support !== false && sessionsEnabled;

        this.transport = new HttpTransport(config.endpoint, config.appId, this.sessionId);
        this.flushCoordinator = new FlushCoordinator();

        // Console prefix for loggers
        this.consolePrefix = config.logging?.consolePrefix ?? '';

        // Unified ingest buffer (handles both events and logs)
        this.ingestBuffer = new IngestBuffer(this.transport, this.identity, this.session.launchTs, config);
        if (loggingEnabled || sessionsEnabled) {
            this.boundFlushFn = () => this.ingestBuffer!.flushBeacon();
            this.flushCoordinator.register(this.boundFlushFn);
        }
        if (loggingEnabled) {
            this.navigationLogger = new NavigationLogger(this.ingestBuffer);
            this.navigationLogger.start();
        }

        // Support (requires sessions)
        if (supportEnabled) {
            this.supportConnection = new SupportConnection(
                config.endpoint,
                this.sessionId,
                config.support?.renderUI !== false,
                {
                    onAgentConnected: config.support?.onAgentConnected,
                    onAgentDisconnected: config.support?.onAgentDisconnected,
                    onAnnotation: config.support?.onAnnotation,
                    onChat: config.support?.onChat
                }
            );
            this.ingestBuffer.setSupportConnection(this.supportConnection);
            this.supportConnection.setOnLiveModeChange(liveEnabled => {
                this.ingestBuffer!.setLiveMode(liveEnabled);
                if (liveEnabled) this.recorder?.takeFullSnapshot();
            });
            this.supportConnection.setOnSnapshotRequested(() => {
                this.recorder?.takeFullSnapshot();
            });
        }

        // Recording / sessions (enabled by default)
        if (sessionsEnabled) {
            this.recorder = new Recorder(this.ingestBuffer, config);
            this.ingestBuffer.onNeedFullSnapshot = () => this.recorder?.takeFullSnapshot();
        }

        // Tracing (enabled by default)
        if (tracingEnabled) {
            this.tracingProvider = new TracingProvider(
                this.transport,
                this.identity,
                this.sessionId,
                config,
                this.ingestBuffer
            );
            this.tracer = this.tracingProvider.tracer;
        }

        _activeTracer = this.tracer;
    }

    identify(identity: UxrrIdentity): void {
        this.identity.identify(identity);
    }

    createLogger(scope: string, data?: Record<string, unknown>): UxrrLogger {
        const consolePrefix = this.consolePrefix ? `${this.consolePrefix}${scope}` : scope;
        return new ScopedLogger(this.ingestBuffer, scope, consolePrefix, data ?? {});
    }

    async flush(): Promise<void> {
        await this.flushCoordinator?.flushAsync();
    }

    stop(): void {
        this.supportConnection?.downgrade();
        this.supportConnection = undefined;
        this.navigationLogger?.stop();
        this.navigationLogger = undefined;
        this.recorder?.stop();
        this.recorder = undefined;
        this.tracingProvider?.shutdown();
        this.tracingProvider = undefined;
        this.ingestBuffer?.stop();
        this.ingestBuffer = undefined;
        if (this.boundFlushFn) {
            this.flushCoordinator?.unregister(this.boundFlushFn);
            this.boundFlushFn = undefined;
        }
    }
}
