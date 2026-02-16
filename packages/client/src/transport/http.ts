export interface PostResult {
    ok: boolean;
    ws?: boolean;
}

export class HttpTransport {
    private readonly baseUrl: string;

    constructor(
        endpoint: string,
        appId: string,
        private readonly sessionId: string
    ) {
        this.baseUrl = endpoint.replace(/\/$/, '');
        this.appId = encodeURIComponent(appId);
    }

    async postJSON(path: string, body: unknown): Promise<PostResult> {
        const url = `${this.baseUrl}/v1/ng/${this.appId}/${this.sessionId}/${path}`;
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(10_000)
            });
            if (!response.ok) return { ok: false };
            try {
                return await response.json();
            } catch {
                return { ok: true };
            }
        } catch {
            return { ok: false };
        }
    }

    sendBeacon(path: string, body: unknown): boolean {
        const url = `${this.baseUrl}/v1/ng/${this.appId}/${this.sessionId}/${path}`;
        const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
        return navigator.sendBeacon(url, blob);
    }

    getIngestUrl(path: string): string {
        return `${this.baseUrl}/v1/ng/${this.appId}/${this.sessionId}/${path}`;
    }
}
