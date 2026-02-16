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

    private readonly flushInterval: number;
    private readonly eventBufferSize: number;
    private readonly maxEvents: number;
    private readonly maxLogQueue: number;
    private readonly meta: { version?: string; environment?: string; userAgent: string };
    private readonly launchTs: number;

    private supportConnection: SupportConnection | null = null;
    onNeedFullSnapshot: (() => void) | null = null;

    constructor(
        private readonly transport: HttpTransport,
        private readonly identity: IdentityManager,
        launchTs: number,
        config: UxrrConfig
    ) {
        this.launchTs = launchTs;
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
        if (events.length > 0) payload.events = events;
        if (logs.length > 0) payload.logs = logs;

        this.transport.postJSON('data', payload).then(result => {
            this.isFlushing = false;
            if (result.ok) {
                this.consecutiveFailures = 0;
                this.handleFlushSuccess();
                if (result.ws && this.supportConnection && !this.supportConnection.isConnected) {
                    this.supportConnection.upgrade();
                }
            } else {
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
        if (events.length > 0) payload.events = events;
        if (logs.length > 0) payload.logs = logs;

        this.transport.sendBeacon('data', payload);
    }

    stop(): void {
        this.stopTimer();
        this.flushBeacon();
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
