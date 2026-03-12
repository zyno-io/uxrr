import type { eventWithTime } from '@rrweb/types';

import type { IdentityManager } from '../identity';
import type { SupportConnection } from '../support/connection';
import type { HttpTransport } from './http';
import type { UxrrConfig } from '../types';

export interface LogEntry {
    t: number; // timestamp
    v: number; // level
    c: string; // scope
    m: string; // message
    d?: Record<string, unknown>; // data
}

const DEFAULT_FLUSH_INTERVAL = 5_000;
const DEFAULT_EVENT_BUFFER_SIZE = 50;
const DEFAULT_MAX_EVENTS = 500;
const DEFAULT_MAX_LOG_QUEUE = 1_500;

export class IngestBuffer {
    private events: eventWithTime[] = [];
    private logs: LogEntry[] = [];
    private timer: ReturnType<typeof setInterval> | undefined;
    private isFlushing = false;
    private needsFullSnapshot = false;
    private liveMode = false;
    private consecutiveFailures = 0;
    private sessionGeneration = 0;

    private readonly flushInterval: number;
    private readonly eventBufferSize: number;
    private readonly maxEvents: number;
    private readonly maxLogQueue: number;
    private readonly meta: { version?: string; environment?: string; userAgent: string };
    private launchTs: number;
    private previousSessionId: string | undefined;

    private supportConnection: SupportConnection | null = null;
    onNeedFullSnapshot: (() => void) | null = null;
    onServerConfig: ((config: { maxIdleTimeout?: number }) => void) | null = null;
    onSessionExpired: (() => void) | null = null;

    constructor(
        private readonly transport: HttpTransport,
        private readonly identity: IdentityManager,
        launchTs: number,
        config: UxrrConfig,
        previousSessionId?: string
    ) {
        this.launchTs = launchTs;
        this.previousSessionId = previousSessionId;
        this.flushInterval = config.logging?.flushInterval ?? DEFAULT_FLUSH_INTERVAL;
        this.eventBufferSize = DEFAULT_EVENT_BUFFER_SIZE;
        this.maxEvents = DEFAULT_MAX_EVENTS;
        this.maxLogQueue = config.logging?.maxQueueSize ?? DEFAULT_MAX_LOG_QUEUE;
        this.meta = {
            version: config.version,
            environment: config.environment,
            userAgent: navigator.userAgent
        };

        this.startTimer();
    }

    setSupportConnection(conn: SupportConnection): void {
        this.supportConnection = conn;
    }

    setLiveMode(enabled: boolean): void {
        this.liveMode = enabled;
        if (enabled) {
            this.stopTimer();
            // flush any buffered data before switching to live mode
            this.flush();
        } else {
            this.startTimer();
        }
    }

    pushEvent(event: eventWithTime): void {
        if (this.liveMode && this.supportConnection?.isConnected) {
            this.supportConnection.sendEvents([event]);
            return;
        }

        this.events.push(event);

        if (this.events.length >= this.maxEvents) {
            // overflow: flush immediately and request full snapshot after next success
            this.needsFullSnapshot = true;
            this.flush();
            return;
        }

        if (this.events.length >= this.eventBufferSize) {
            this.flush();
        }
    }

    pushLog(entry: LogEntry): void {
        if (this.liveMode && this.supportConnection?.isConnected) {
            this.supportConnection.sendLogs([entry]);
            return;
        }

        this.logs.push(entry);

        while (this.logs.length > this.maxLogQueue) {
            this.logs.shift();
        }
    }

    flush(): void {
        if (this.isFlushing) return;
        if (this.events.length === 0 && this.logs.length === 0) return;

        this.isFlushing = true;

        const events = this.events.splice(0);
        const logs = this.logs.splice(0);

        // if WS is active (but not in live mode push path), send via WS
        if (this.supportConnection?.isConnected) {
            if (events.length > 0) this.supportConnection.sendEvents(events);
            if (logs.length > 0) this.supportConnection.sendLogs(logs);
            this.isFlushing = false;
            this.handleFlushSuccess();
            return;
        }

        const payload: Record<string, unknown> = {
            identity: this.identity.toPayload(),
            meta: this.meta,
            launchTs: this.launchTs
        };
        if (this.previousSessionId) payload.previousSessionId = this.previousSessionId;
        if (events.length > 0) payload.events = events;
        if (logs.length > 0) payload.logs = logs;

        const generation = this.sessionGeneration;

        this.transport.postJSON('data', payload).then(result => {
            this.isFlushing = false;
            if (result.ok) {
                this.consecutiveFailures = 0;
                this.handleFlushSuccess();
                if (result.config) {
                    this.onServerConfig?.(result.config);
                }
                if (result.ws && this.supportConnection && !this.supportConnection.isConnected) {
                    this.supportConnection.upgrade();
                }
            } else if (result.status === 410) {
                // Session expired server-side; drop data and trigger rotation
                console.warn('[uxrr] session expired server-side, rotating');
                this.needsFullSnapshot = true;
                this.onSessionExpired?.();
            } else if (result.status === 413) {
                this.handlePayloadTooLarge(events, logs, payload, generation);
            } else {
                // Don't re-queue if session has rotated since this flush started
                if (generation !== this.sessionGeneration) return;

                this.consecutiveFailures++;
                if (this.consecutiveFailures >= 3) {
                    // drop events after 3 consecutive failures; request full snapshot on recovery
                    this.consecutiveFailures = 0;
                    this.needsFullSnapshot = true;
                } else {
                    // re-queue events for retry
                    this.events.unshift(...events);
                }
                // re-queue logs for retry
                this.logs.unshift(...logs);
                while (this.logs.length > this.maxLogQueue) {
                    this.logs.shift();
                }
            }
        });
    }

    flushBeacon(): void {
        if (this.events.length === 0 && this.logs.length === 0) return;

        const events = this.events.splice(0);
        const logs = this.logs.splice(0);

        const payload: Record<string, unknown> = {
            identity: this.identity.toPayload(),
            meta: this.meta,
            launchTs: this.launchTs
        };
        if (this.previousSessionId) payload.previousSessionId = this.previousSessionId;
        if (events.length > 0) payload.events = events;
        if (logs.length > 0) payload.logs = logs;

        this.transport.sendBeacon('data', payload);
    }

    resetSession(launchTs: number, previousSessionId: string): void {
        this.sessionGeneration++;
        this.consecutiveFailures = 0;
        this.launchTs = launchTs;
        this.previousSessionId = previousSessionId;
    }

    stop(): void {
        this.stopTimer();
        this.flushBeacon();
    }

    private handlePayloadTooLarge(
        events: eventWithTime[],
        logs: LogEntry[],
        basePayload: Record<string, unknown>,
        generation: number
    ): void {
        const sendSplit = async () => {
            // try events alone
            if (events.length > 0) {
                const eventsPayload = { ...basePayload, events, logs: undefined };
                delete eventsPayload.logs;
                const eventsResult = await this.transport.postJSON('data', eventsPayload);
                if (eventsResult.status === 413) {
                    console.warn('[uxrr] dropping %d events: payload too large', events.length);
                    this.needsFullSnapshot = true;
                } else if (eventsResult.status === 410) {
                    console.warn('[uxrr] session expired server-side, rotating');
                    this.needsFullSnapshot = true;
                    this.onSessionExpired?.();
                    return;
                } else if (!eventsResult.ok) {
                    if (generation === this.sessionGeneration) {
                        this.events.unshift(...events);
                    }
                } else {
                    this.applyResultConfig(eventsResult);
                }
            }

            // try logs alone
            if (logs.length > 0) {
                const logsPayload = { ...basePayload, logs, events: undefined };
                delete logsPayload.events;
                const logsResult = await this.transport.postJSON('data', logsPayload);
                if (logsResult.status === 413) {
                    console.warn('[uxrr] dropping %d logs: payload too large', logs.length);
                } else if (logsResult.status === 410) {
                    console.warn('[uxrr] session expired server-side, rotating');
                    this.needsFullSnapshot = true;
                    this.onSessionExpired?.();
                } else if (!logsResult.ok) {
                    if (generation === this.sessionGeneration) {
                        this.logs.unshift(...logs);
                        while (this.logs.length > this.maxLogQueue) {
                            this.logs.shift();
                        }
                    }
                } else {
                    this.applyResultConfig(logsResult);
                }
            }
        };

        sendSplit();
    }

    private applyResultConfig(result: import('./http').PostResult): void {
        if (result.config) {
            this.onServerConfig?.(result.config);
        }
        if (result.ws && this.supportConnection && !this.supportConnection.isConnected) {
            this.supportConnection.upgrade();
        }
    }

    private handleFlushSuccess(): void {
        if (this.needsFullSnapshot) {
            this.needsFullSnapshot = false;
            this.onNeedFullSnapshot?.();
        }
    }

    private startTimer(): void {
        this.stopTimer();
        this.timer = setInterval(() => this.flush(), this.flushInterval);
    }

    private stopTimer(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }
}
