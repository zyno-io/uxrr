const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'pointerdown'] as const;

export class IdleMonitor {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private readonly boundOnActivity: () => void;
    private isIdle = false;

    constructor(
        private timeoutMs: number,
        private readonly onIdle: () => void,
        private readonly onDeIdle: () => void
    ) {
        this.boundOnActivity = this.onActivity.bind(this);
        for (const event of ACTIVITY_EVENTS) {
            document.addEventListener(event, this.boundOnActivity, { capture: true, passive: true });
        }
        this.resetTimer();
    }

    updateTimeout(timeoutMs: number): void {
        this.timeoutMs = timeoutMs;
        if (!this.isIdle) {
            this.resetTimer();
        }
    }

    stop(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        for (const event of ACTIVITY_EVENTS) {
            document.removeEventListener(event, this.boundOnActivity, { capture: true });
        }
    }

    private onActivity(): void {
        if (this.isIdle) {
            this.isIdle = false;
            this.onDeIdle();
        }
        this.resetTimer();
    }

    private resetTimer(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.isIdle = true;
            this.onIdle();
            // Don't restart timer — wait for activity to resume (onDeIdle)
        }, this.timeoutMs);
    }
}
