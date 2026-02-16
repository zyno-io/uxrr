import type { IngestBuffer } from '../transport/ingest-buffer';

type NavigationSource = 'init' | 'pushState' | 'replaceState' | 'popstate' | 'hashchange';

type HistoryMethod = 'pushState' | 'replaceState';

const NAVIGATION_SCOPE = 'uxrr:navigation';

export class NavigationLogger {
    private readonly originalPushState: History['pushState'];
    private readonly originalReplaceState: History['replaceState'];
    private lastUrl: string;

    private readonly onPopState = (): void => {
        this.capture('popstate');
    };

    private readonly onHashChange = (event: HashChangeEvent): void => {
        this.capture('hashchange', event.oldURL, event.newURL);
    };

    constructor(private readonly ingestBuffer: IngestBuffer) {
        this.originalPushState = history.pushState.bind(history);
        this.originalReplaceState = history.replaceState.bind(history);
        this.lastUrl = window.location.href;
    }

    start(): void {
        this.capture('init', undefined, window.location.href);

        this.patchHistoryMethod('pushState');
        this.patchHistoryMethod('replaceState');

        window.addEventListener('popstate', this.onPopState);
        window.addEventListener('hashchange', this.onHashChange);
    }

    stop(): void {
        history.pushState = this.originalPushState;
        history.replaceState = this.originalReplaceState;

        window.removeEventListener('popstate', this.onPopState);
        window.removeEventListener('hashchange', this.onHashChange);
    }

    private patchHistoryMethod(method: HistoryMethod): void {
        const original = method === 'pushState' ? this.originalPushState : this.originalReplaceState;

        history[method] = ((...args: Parameters<History['pushState']>): ReturnType<History['pushState']> => {
            const fromUrl = window.location.href;
            const result = original(...args);
            this.capture(method, fromUrl);
            return result;
        }) as History['pushState'];
    }

    private capture(source: NavigationSource, fromUrl?: string, toUrl?: string): void {
        const destination = toUrl ?? window.location.href;
        const previous = fromUrl ?? this.lastUrl;

        // Ignore no-op URL updates after init.
        if (source !== 'init' && destination === this.lastUrl) {
            return;
        }

        this.ingestBuffer.pushLog({
            t: Date.now(),
            v: 1,
            c: NAVIGATION_SCOPE,
            m: `navigation ${destination}`,
            d: {
                source,
                url: destination,
                fromUrl: previous,
                toUrl: destination,
                referrer: document.referrer || undefined
            }
        });

        this.lastUrl = destination;
    }
}
