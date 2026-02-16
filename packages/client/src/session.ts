import { uuidv7 } from './uuid';

const SESSION_ID_KEY = 'uxrr:sessionId';

export class SessionManager {
    readonly sessionId: string;
    readonly launchTs: number;

    constructor() {
        this.launchTs = Date.now();

        const existingSessionId = sessionStorage.getItem(SESSION_ID_KEY);
        this.sessionId = existingSessionId ?? uuidv7();

        if (!existingSessionId) {
            sessionStorage.setItem(SESSION_ID_KEY, this.sessionId);
        }
    }
}
