import { eventDispatcher } from '@deepkit/event';
import { httpWorkflow } from '@deepkit/http';

export class SecurityHeadersListener {
    @eventDispatcher.listen(httpWorkflow.onResponse, 100)
    onResponse(event: typeof httpWorkflow.onResponse.event): void {
        const res = event.response;
        if (!res.headersSent) {
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Frame-Options', 'SAMEORIGIN');
            res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
            res.setHeader('X-XSS-Protection', '0');
            res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
            res.setHeader('Content-Security-Policy', "default-src 'none'");
            res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
            res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        }
    }
}
