import { getRecordConsolePlugin } from '@rrweb/rrweb-plugin-console-record';
import type { eventWithTime } from '@rrweb/types';
import { record } from 'rrweb';

import type { UxrrConfig } from '../types';
import type { IngestBuffer } from '../transport/ingest-buffer';

export class Recorder {
    private stopFn: (() => void) | undefined;

    constructor(
        private readonly buffer: IngestBuffer,
        config: UxrrConfig
    ) {
        try {
            const privacy = config.recording?.privacy;

            this.stopFn =
                record({
                    emit: (event: eventWithTime) => {
                        this.buffer.pushEvent(event);
                    },
                    checkoutEveryNms: 120_000,
                    maskAllInputs: privacy?.maskInputs ?? true,
                    maskInputOptions: { password: true },
                    maskTextSelector: privacy?.maskTextContent ? '*' : undefined,
                    blockSelector: privacy?.blockSelector,
                    plugins: [
                        getRecordConsolePlugin({
                            level: privacy?.consoleLogLevel ?? ['warn', 'error', 'assert'],
                            lengthThreshold: 10000,
                            stringifyOptions: {
                                stringLengthLimit: 1000,
                                numOfKeysLimit: 100,
                                depthOfLimit: 5
                            }
                        })
                    ]
                }) ?? undefined;
        } catch (err) {
            console.warn('[uxrr] Session recording unavailable — rrweb failed to initialize:', err);
        }
    }

    takeFullSnapshot(): void {
        record.takeFullSnapshot();
    }

    stop(): void {
        this.stopFn?.();
        this.stopFn = undefined;
    }
}
