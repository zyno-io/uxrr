import type { Tracer } from '@opentelemetry/api';

import { trace } from '@opentelemetry/api';

import type { Recorder } from './recording/recorder';
import type { TracingProvider } from './tracing/provider';
import type { UxrrConfig, UxrrIdentity, UxrrInstance, UxrrLogger } from './types';

import { IdentityManager } from './identity';
import { IdleMonitor } from './idle-monitor';
import { ScopedLogger } from './logging/logger';
import { NavigationLogger } from './logging/navigation';
import { SessionManager } from './session';
import { SupportConnection } from './support/connection';
import { FlushCoordinator } from './transport/flush';
import { HttpTransport } from './transport/http';
import { IngestBuffer } from './transport/ingest-buffer';

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

const DEFAULT_IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes

class UXRR implements UxrrInstance {
    get sessionId(): string {
        return this.session.sessionId;
    }

    tracer: Tracer;

    private readonly identity: IdentityManager;
    private readonly session: SessionManager;
    private consolePrefix = '';
    private config: UxrrConfig | undefined;
    private transport: HttpTransport | undefined;
    private flushCoordinator: FlushCoordinator | undefined;
    private ingestBuffer: IngestBuffer | undefined;
    private recorder: Recorder | undefined;
    private tracingProvider: TracingProvider | undefined;
    private supportConnection: SupportConnection | undefined;
    private navigationLogger: NavigationLogger | undefined;
    private idleMonitor: IdleMonitor | undefined;
    private boundFlushFn: (() => void) | undefined;

    constructor() {
        this.identity = new IdentityManager();
        this.session = new SessionManager();
        this.session.setOnSessionReset(() => this.handleDuplicateTabDetected());
        this.tracer = trace.getTracer('uxrr');
    }

    private handleDuplicateTabDetected(): void {
        // Called when BroadcastChannel detects another tab using the same session ID.
        // session.reset() has already been called, so we just need to update subsystems.

        // Update transport to use new session ID
        this.transport?.setSessionId(this.sessionId);

        // Update tracing processor to tag spans with new session ID
        this.tracingProvider?.updateSessionId(this.sessionId);

        // Update ingest buffer with new session timing + link
        // previousSessionId is guaranteed to be set since reset() was called
        this.ingestBuffer?.resetSession(this.session.launchTs, this.session.previousSessionId!);

        // Update support connection to use new session ID for future upgrades
        this.supportConnection?.updateSessionId(this.sessionId);

        // Take a fresh rrweb snapshot for the new session
        this.recorder?.takeFullSnapshot();
    }

    init(config: UxrrConfig): void {
        // Tear down previous subsystems on re-init
        if (this.ingestBuffer || this.recorder || this.tracingProvider || this.supportConnection) {
            this.stop();
        }

        this.config = config;

        const enabled = config.enabled ?? {};
        const sessionsEnabled = enabled.sessions !== false;
        const loggingEnabled = enabled.logging !== false;
        const tracingEnabled = enabled.tracing !== false;
        const supportEnabled = enabled.support !== false && sessionsEnabled;

        this.transport = new HttpTransport(config.endpoint, config.appKey, this.sessionId);
        this.flushCoordinator = new FlushCoordinator();

        // Console prefix for loggers
        this.consolePrefix = config.logging?.consolePrefix ?? '';

        // Unified ingest buffer (handles both events and logs)
        this.ingestBuffer = new IngestBuffer(this.transport, this.identity, this.session.launchTs, config, this.session.previousSessionId);
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
            this.supportConnection = new SupportConnection(config.endpoint, this.sessionId, config.support?.renderUI !== false, {
                onAgentConnected: config.support?.onAgentConnected,
                onAgentDisconnected: config.support?.onAgentDisconnected,
                onAnnotation: config.support?.onAnnotation,
                onChat: config.support?.onChat
            });
            this.ingestBuffer.setSupportConnection(this.supportConnection);
            this.supportConnection.setOnLiveModeChange(liveEnabled => {
                this.ingestBuffer!.setLiveMode(liveEnabled);
                if (liveEnabled) this.recorder?.takeFullSnapshot();
            });
            this.supportConnection.setOnSnapshotRequested(() => {
                this.recorder?.takeFullSnapshot();
            });
        }

        // Recording / sessions (enabled by default) — loaded async
        if (sessionsEnabled) {
            this.initRecording(config);
        }

        // Tracing (enabled by default) — loaded async
        if (tracingEnabled) {
            this.initTracing(config);
        }

        // Idle session reset — server config takes precedence over local config
        if (sessionsEnabled) {
            const idleTimeout = config.idleTimeout ?? DEFAULT_IDLE_TIMEOUT;
            if (idleTimeout > 0) {
                this.idleMonitor = new IdleMonitor(
                    idleTimeout,
                    () => this.ingestBuffer?.flush(),
                    () => this.resetSession()
                );
            }

            this.ingestBuffer.onServerConfig = serverConfig => {
                if (serverConfig.maxIdleTimeout !== undefined) {
                    if (this.idleMonitor) {
                        this.idleMonitor.updateTimeout(serverConfig.maxIdleTimeout);
                    } else if (serverConfig.maxIdleTimeout > 0) {
                        this.idleMonitor = new IdleMonitor(
                            serverConfig.maxIdleTimeout,
                            () => this.ingestBuffer?.flush(),
                            () => this.resetSession()
                        );
                    }
                }
            };

            this.ingestBuffer.onSessionExpired = () => this.resetSession();
        }
    }

    private resetSession(): void {
        // Don't reset during an active live support session
        if (this.supportConnection?.isConnected) return;

        // Reset session ID
        const oldSessionId = this.session.reset();

        // Update transport to use new session ID
        this.transport?.setSessionId(this.sessionId);

        // Update tracing processor to tag spans with new session ID
        this.tracingProvider?.updateSessionId(this.sessionId);

        // Update ingest buffer with new session timing + link
        this.ingestBuffer?.resetSession(this.session.launchTs, oldSessionId);

        // Update support connection to use new session ID for future upgrades
        this.supportConnection?.updateSessionId(this.sessionId);

        // Take a fresh rrweb snapshot for the new session
        this.recorder?.takeFullSnapshot();
    }

    private async initRecording(config: UxrrConfig): Promise<void> {
        const { createRecorder } = await import('./recording/recorder');
        if (!this.ingestBuffer) return; // guard against stop() called before load
        this.recorder = await createRecorder(this.ingestBuffer, config);
        this.ingestBuffer.onNeedFullSnapshot = () => this.recorder?.takeFullSnapshot();
    }

    private async initTracing(config: UxrrConfig): Promise<void> {
        const { createTracingProvider } = await import('./tracing/provider');
        if (!this.transport) return; // guard against stop() called before load
        this.tracingProvider = await createTracingProvider(this.transport, this.identity, this.sessionId, config, this.ingestBuffer);
        this.tracer = this.tracingProvider.tracer;
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
        this.idleMonitor?.stop();
        this.idleMonitor = undefined;
        this.session.stop();
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
