import { uuidv7 } from './uuid';

const SESSION_ID_KEY = 'uxrr:sessionId';
const PREVIOUS_SESSION_ID_KEY = 'uxrr:previousSessionId';
const BROADCAST_CHANNEL_NAME = 'uxrr:session';
const SESSION_OWNER_KEY_PREFIX = 'uxrr:sessionOwner:';
const OWNER_HEARTBEAT_INTERVAL_MS = 2_000;
const OWNER_STALE_MS = 60_000;

interface SessionOwner {
    instanceId: string;
    ts: number;
}

export class SessionManager {
    sessionId: string;
    launchTs: number;
    previousSessionId: string | undefined;

    private readonly instanceId = uuidv7();
    private channel: BroadcastChannel | undefined;
    private ownerHeartbeat: ReturnType<typeof setInterval> | undefined;
    private ownerLifecycleActive = false;
    private readonly boundReleaseOwner = () => this.releaseOwner(this.sessionId);
    private onSessionReset: (() => void) | undefined;

    constructor() {
        this.launchTs = Date.now();
        this.previousSessionId = sessionStorage.getItem(PREVIOUS_SESSION_ID_KEY) ?? undefined;

        const existingSessionId = sessionStorage.getItem(SESSION_ID_KEY);
        this.sessionId = existingSessionId ?? uuidv7();

        if (!existingSessionId) {
            sessionStorage.setItem(SESSION_ID_KEY, this.sessionId);
        }

        this.start(existingSessionId !== null);
    }

    start(needsDuplicateCheck = sessionStorage.getItem(SESSION_ID_KEY) === this.sessionId): void {
        if (this.isOwnedByAnotherLiveInstance(this.sessionId)) {
            this.reset();
            needsDuplicateCheck = false;
        } else {
            this.claimOwner();
        }

        this.initOwnerLifecycle();
        this.initBroadcastChannel(needsDuplicateCheck);
    }

    /**
     * Set a callback to be invoked if session is reset due to duplicate tab detection.
     * This allows UXRR to update transports, take fresh snapshots, etc.
     */
    setOnSessionReset(callback: () => void): void {
        this.onSessionReset = callback;
    }

    private initBroadcastChannel(needsDuplicateCheck: boolean): void {
        if (typeof BroadcastChannel === 'undefined') return;
        if (this.channel) return;

        this.channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);

        // Always listen for session checks from other tabs
        this.channel.onmessage = (e: MessageEvent) => {
            if (e.data?.type === 'session-check' && e.data.sessionId === this.sessionId) {
                // Another tab is asking if this session ID is in use - respond yes
                this.channel!.postMessage({ type: 'session-in-use', sessionId: this.sessionId });
            } else if (e.data?.type === 'session-in-use' && e.data.sessionId === this.sessionId) {
                // Conflict detected - we need to generate a new session
                this.handleDuplicateDetected();
            }
        };

        // If we loaded with an existing session ID from sessionStorage, check for duplicates
        if (needsDuplicateCheck) {
            this.channel.postMessage({ type: 'session-check', sessionId: this.sessionId });
        }
    }

    private handleDuplicateDetected(): void {
        // Generate new session, treating old one as previous
        this.reset();
        // Notify UXRR so it can update transports, take snapshots, etc.
        this.onSessionReset?.();
    }

    reset(): string {
        const oldSessionId = this.sessionId;
        this.releaseOwner(oldSessionId);
        this.previousSessionId = oldSessionId;
        this.sessionId = uuidv7();
        this.launchTs = Date.now();
        sessionStorage.setItem(SESSION_ID_KEY, this.sessionId);
        sessionStorage.setItem(PREVIOUS_SESSION_ID_KEY, oldSessionId);
        this.claimOwner();
        return oldSessionId;
    }

    stop(): void {
        this.releaseOwner(this.sessionId);
        this.stopOwnerHeartbeat();
        this.removeOwnerLifecycle();
        this.channel?.close();
        this.channel = undefined;
    }

    private initOwnerLifecycle(): void {
        if (typeof window === 'undefined') return;
        if (this.ownerLifecycleActive) return;
        window.addEventListener('pagehide', this.boundReleaseOwner);
        window.addEventListener('beforeunload', this.boundReleaseOwner);
        this.ownerLifecycleActive = true;
    }

    private removeOwnerLifecycle(): void {
        if (typeof window === 'undefined') return;
        if (!this.ownerLifecycleActive) return;
        window.removeEventListener('pagehide', this.boundReleaseOwner);
        window.removeEventListener('beforeunload', this.boundReleaseOwner);
        this.ownerLifecycleActive = false;
    }

    private claimOwner(): void {
        if (this.isOwnedByAnotherLiveInstance(this.sessionId)) {
            this.handleDuplicateDetected();
            return;
        }

        this.writeOwner(this.sessionId);
        this.startOwnerHeartbeat();
    }

    private startOwnerHeartbeat(): void {
        this.stopOwnerHeartbeat();
        this.ownerHeartbeat = setInterval(() => {
            this.writeOwner(this.sessionId);
        }, OWNER_HEARTBEAT_INTERVAL_MS);
    }

    private stopOwnerHeartbeat(): void {
        if (this.ownerHeartbeat) {
            clearInterval(this.ownerHeartbeat);
            this.ownerHeartbeat = undefined;
        }
    }

    private isOwnedByAnotherLiveInstance(sessionId: string): boolean {
        const owner = this.readOwner(sessionId);
        if (!owner || owner.instanceId === this.instanceId) return false;

        if (Date.now() - owner.ts > OWNER_STALE_MS) {
            this.removeOwner(sessionId, owner.instanceId);
            return false;
        }

        return true;
    }

    private writeOwner(sessionId: string): void {
        try {
            localStorage.setItem(
                this.ownerKey(sessionId),
                JSON.stringify({
                    instanceId: this.instanceId,
                    ts: Date.now()
                } satisfies SessionOwner)
            );
        } catch {
            // localStorage can be disabled in privacy-restricted contexts.
        }
    }

    private releaseOwner(sessionId: string): void {
        this.removeOwner(sessionId, this.instanceId);
    }

    private removeOwner(sessionId: string, instanceId: string): void {
        try {
            const owner = this.readOwner(sessionId);
            if (owner?.instanceId === instanceId) {
                localStorage.removeItem(this.ownerKey(sessionId));
            }
        } catch {
            // best-effort cleanup only
        }
    }

    private readOwner(sessionId: string): SessionOwner | undefined {
        try {
            const raw = localStorage.getItem(this.ownerKey(sessionId));
            if (!raw) return undefined;
            const parsed = JSON.parse(raw) as Partial<SessionOwner>;
            if (typeof parsed.instanceId !== 'string' || typeof parsed.ts !== 'number') {
                localStorage.removeItem(this.ownerKey(sessionId));
                return undefined;
            }
            return { instanceId: parsed.instanceId, ts: parsed.ts };
        } catch {
            return undefined;
        }
    }

    private ownerKey(sessionId: string): string {
        return `${SESSION_OWNER_KEY_PREFIX}${sessionId}`;
    }
}
