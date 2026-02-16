/**
 * Sliding-window rate limiter.
 * Tracks request timestamps per key and rejects when the count
 * within the window exceeds the configured limit.
 */
export class RateLimiter {
    private readonly windows = new Map<string, number[]>();
    private cleanupTimer: ReturnType<typeof setInterval>;

    constructor(
        private readonly maxRequests: number,
        private readonly windowMs: number
    ) {
        // Periodically prune stale keys to prevent memory leaks
        this.cleanupTimer = setInterval(() => this.cleanup(), windowMs * 2);
    }

    isAllowed(key: string): boolean {
        const now = Date.now();
        const cutoff = now - this.windowMs;

        let timestamps = this.windows.get(key);
        if (!timestamps) {
            timestamps = [];
            this.windows.set(key, timestamps);
        }

        // Remove expired timestamps from the front
        while (timestamps.length > 0 && timestamps[0] <= cutoff) {
            timestamps.shift();
        }

        if (timestamps.length >= this.maxRequests) {
            return false;
        }

        timestamps.push(now);
        return true;
    }

    stop(): void {
        clearInterval(this.cleanupTimer);
    }

    private cleanup(): void {
        const cutoff = Date.now() - this.windowMs;
        for (const [key, timestamps] of this.windows) {
            while (timestamps.length > 0 && timestamps[0] <= cutoff) {
                timestamps.shift();
            }
            if (timestamps.length === 0) {
                this.windows.delete(key);
            }
        }
    }
}
