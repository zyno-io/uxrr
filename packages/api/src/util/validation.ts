import { HttpBadRequestError } from '@deepkit/http';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateSessionId(sessionId: string): void {
    if (!UUID_RE.test(sessionId)) {
        throw new HttpBadRequestError('Invalid session ID format');
    }
}
