import { uuidv7 } from './uuid';

const SESSION_ID_KEY = 'uxrr:sessionId';
const PREVIOUS_SESSION_ID_KEY = 'uxrr:previousSessionId';
const BROADCAST_CHANNEL_NAME = 'uxrr:session';
const DUPLICATE_CHECK_TIMEOUT_MS = 100;

export class SessionManager {
    sessionId: string;
    launchTs: number;
    previousSessionId: string | undefined;

    private channel: BroadcastChannel | undefined;
    private onSessionReset: (() => void) | undefined;

    constructor() {
        this.launchTs = Date.now();
        this.previousSessionId = sessionStorage.getItem(PREVIOUS_SESSION_ID_KEY) ?? undefined;

        const existingSessionId = sessionStorage.getItem(SESSION_ID_KEY);
        this.sessionId = existingSessionId ?? uuidv7();

        if (!existingSessionId) {
            sessionStorage.setItem(SESSION_ID_KEY, this.sessionId);
        }

        this.initBroadcastChannel(existingSessionId !== null);
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

            // After timeout, stop listening for duplicate responses for this initial check
            // (we'll still respond to future checks from other tabs)
            setTimeout(() => {
                // No action needed - if we received a session-in-use, we already handled it
            }, DUPLICATE_CHECK_TIMEOUT_MS);
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
        this.previousSessionId = oldSessionId;
        this.sessionId = uuidv7();
        this.launchTs = Date.now();
        sessionStorage.setItem(SESSION_ID_KEY, this.sessionId);
        sessionStorage.setItem(PREVIOUS_SESSION_ID_KEY, oldSessionId);
        return oldSessionId;
    }

    stop(): void {
        this.channel?.close();
        this.channel = undefined;
    }
}
