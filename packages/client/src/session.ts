import { uuidv7 } from './uuid';

const SESSION_ID_KEY = 'uxrr:sessionId';
const PREVIOUS_SESSION_ID_KEY = 'uxrr:previousSessionId';

export class SessionManager {
    sessionId: string;
    launchTs: number;
    previousSessionId: string | undefined;

    constructor() {
        this.launchTs = Date.now();
        this.previousSessionId = sessionStorage.getItem(PREVIOUS_SESSION_ID_KEY) ?? undefined;

        const existingSessionId = sessionStorage.getItem(SESSION_ID_KEY);
        this.sessionId = existingSessionId ?? uuidv7();

        if (!existingSessionId) {
            sessionStorage.setItem(SESSION_ID_KEY, this.sessionId);
        }
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
}
