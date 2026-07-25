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
const DEFAULT_MAX_SESSION_DURATION = 12 * 60 * 60 * 1000; // 12 hours

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
    private maxSessionDuration: number | undefined;
    private maxSessionTimer: ReturnType<typeof setTimeout> | undefined;
    private boundFlushFn: (() => void) | undefined;
    // Bumped on every init() and stop() so async subsystem loads can tell they're still current.
    private generation = 0;

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

        this.armMaxSessionTimer();
    }

    init(config: UxrrConfig): void {
        // Tear down previous subsystems on re-init
        if (this.ingestBuffer || this.recorder || this.tracingProvider || this.supportConnection) {
            this.stop();
        }

        const generation = ++this.generation;
        this.session.start();
        this.config = config;

        const enabled = config.enabled ?? {};
        const sessionsEnabled = enabled.sessions !== false;
        const loggingEnabled = enabled.logging !== false;
        const tracingEnabled = enabled.tracing !== false;
        const supportEnabled = enabled.support !== false && sessionsEnabled;

        // Console prefix for loggers
        this.consolePrefix = config.logging?.consolePrefix ?? '';

        // Everything that leaves the browser needs both an endpoint to ship to and an app key to ship
        // as. Without them we deliberately still come up — tracing installs, so requests carry trace
        // IDs the backend can correlate on — we just never send anything. That keeps trace context
        // identical between a configured build and an unconfigured one (e.g. local dev).
        const canShip = !!config.endpoint && !!config.appKey;
        if (!canShip) {
            console.warn(
                `${this.consolePrefix}uxrr: no ${!config.endpoint && !config.appKey ? 'endpoint or appKey' : !config.endpoint ? 'endpoint' : 'appKey'} configured — ` +
                    'sessions, logs and traces will NOT be shipped. Tracing is still installed, so requests carry trace IDs.'
            );
        }

        if (canShip) {
            this.transport = new HttpTransport(config.endpoint!, config.appKey!, this.sessionId);
            this.flushCoordinator = new FlushCoordinator();

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
        }

        // Support (requires sessions + somewhere to connect to)
        if (supportEnabled && canShip) {
            this.supportConnection = new SupportConnection(config.endpoint!, this.sessionId, config.support?.renderUI !== false, {
                onAgentConnected: config.support?.onAgentConnected,
                onAgentDisconnected: config.support?.onAgentDisconnected,
                onAnnotation: config.support?.onAnnotation,
                onChat: config.support?.onChat
            });
            this.ingestBuffer!.setSupportConnection(this.supportConnection);
            this.supportConnection.setOnLiveModeChange(liveEnabled => {
                this.ingestBuffer!.setLiveMode(liveEnabled);
                if (liveEnabled) this.recorder?.takeFullSnapshot();
            });
            this.supportConnection.setOnSnapshotRequested(() => {
                this.recorder?.takeFullSnapshot();
            });
        }

        // Recording / sessions (enabled by default) — loaded async. Nothing to record into without a
        // buffer, and skipping it keeps rrweb out of the bundle for unconfigured builds.
        if (sessionsEnabled && canShip) {
            this.initRecording(config);
        }

        // Tracing (enabled by default) — loaded async. Runs with or without an endpoint; see
        // createTracingProvider for what changes when there's nowhere to export to.
        if (tracingEnabled) {
            this.initTracing(config, generation);
        }

        // The rest is session lifecycle: it only exists to keep shipped sessions well-formed, so it's
        // all inert when we aren't shipping (and the session ID simply stays put for the tab).
        if (canShip) {
            // Server config applies to the shared /data ingest path, including logging-only clients.
            this.ingestBuffer!.onServerConfig = serverConfig => {
                if (sessionsEnabled && serverConfig.maxIdleTimeout !== undefined) {
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
                if (serverConfig.maxSessionDuration !== undefined) {
                    this.updateMaxSessionDuration(serverConfig.maxSessionDuration);
                }
            };

            this.ingestBuffer!.onSessionExpired = () => this.resetSession();
            this.updateMaxSessionDuration(config.maxSessionDuration ?? DEFAULT_MAX_SESSION_DURATION);

            // Idle session reset uses DOM activity and only applies when rrweb sessions are enabled.
            if (sessionsEnabled) {
                const idleTimeout = config.idleTimeout ?? DEFAULT_IDLE_TIMEOUT;
                if (idleTimeout > 0) {
                    this.idleMonitor = new IdleMonitor(
                        idleTimeout,
                        () => this.ingestBuffer?.flush(),
                        () => this.resetSession()
                    );
                }
            }
        }
    }

    private resetSession(): void {
        // Don't reset during an active live support session
        if (this.supportConnection?.isConnected) {
            this.armMaxSessionTimer(60_000);
            return;
        }

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

        this.armMaxSessionTimer();
    }

    private async rotateMaxDurationSession(): Promise<void> {
        if (this.supportConnection?.isConnected) {
            this.armMaxSessionTimer(60_000);
            return;
        }

        const drained = (await this.ingestBuffer?.flushForSessionRotation()) ?? true;
        if (!drained) {
            this.armMaxSessionTimer(60_000);
            return;
        }

        this.resetSession();
    }

    private updateMaxSessionDuration(maxSessionDuration: number): void {
        this.maxSessionDuration = maxSessionDuration;
        this.armMaxSessionTimer();
    }

    private armMaxSessionTimer(retryDelay?: number): void {
        this.clearMaxSessionTimer();
        if (!this.maxSessionDuration || this.maxSessionDuration <= 0) return;
        const delay = retryDelay ?? Math.max(0, this.session.launchTs + this.maxSessionDuration - Date.now());
        this.maxSessionTimer = setTimeout(() => {
            void this.rotateMaxDurationSession();
        }, delay);
    }

    private clearMaxSessionTimer(): void {
        if (this.maxSessionTimer) {
            clearTimeout(this.maxSessionTimer);
            this.maxSessionTimer = undefined;
        }
    }

    private async initRecording(config: UxrrConfig): Promise<void> {
        const { createRecorder } = await import('./recording/recorder');
        if (!this.ingestBuffer) return; // guard against stop() called before load
        const recorder = await createRecorder(this.ingestBuffer, config);
        if (!this.ingestBuffer) {
            recorder.stop();
            return;
        }
        this.recorder = recorder;
        this.ingestBuffer.onNeedFullSnapshot = () => this.recorder?.takeFullSnapshot();
    }

    private async initTracing(config: UxrrConfig, generation: number): Promise<void> {
        const { createTracingProvider } = await import('./tracing/provider');
        // Tracing runs without a transport, so it can't use one as its liveness check the way
        // recording uses the ingest buffer — the generation counter tells us if stop() / a re-init
        // landed while we were loading.
        if (generation !== this.generation) return;
        const provider = await createTracingProvider(this.transport, this.identity, this.sessionId, config, this.ingestBuffer);
        if (generation !== this.generation) {
            void provider.shutdown();
            return;
        }
        this.tracingProvider = provider;
        this.tracer = provider.tracer;
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
        this.generation++;
        this.clearMaxSessionTimer();
        this.maxSessionDuration = undefined;
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
        // Both are conditional on shipping now, so a re-init that drops the endpoint must not inherit
        // the previous run's transport.
        this.flushCoordinator = undefined;
        this.transport = undefined;
    }
}
