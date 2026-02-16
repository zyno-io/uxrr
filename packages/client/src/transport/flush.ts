export type FlushFn = () => void;

export class FlushCoordinator {
    private flushFns: FlushFn[] = [];
    private bound = false;

    register(fn: FlushFn): void {
        this.flushFns.push(fn);
        if (!this.bound) {
            this.bind();
        }
    }

    unregister(fn: FlushFn): void {
        this.flushFns = this.flushFns.filter(f => f !== fn);
    }

    private bind(): void {
        this.bound = true;

        const flushAll = () => {
            for (const fn of this.flushFns) {
                try {
                    fn();
                } catch {
                    // best-effort
                }
            }
        };

        window.addEventListener('beforeunload', flushAll);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                flushAll();
            }
        });
    }

    async flushAsync(): Promise<void> {
        for (const fn of this.flushFns) {
            try {
                fn();
            } catch {
                // best-effort
            }
        }
    }
}
