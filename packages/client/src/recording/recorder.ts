import type { eventWithTime } from '@rrweb/types';
import type { recordOptions } from 'rrweb';

import type { UxrrConfig } from '../types';
import type { IngestBuffer } from '../transport/ingest-buffer';

type RecordFn = {
    (options: recordOptions<eventWithTime>): (() => void) | undefined;
    takeFullSnapshot: () => void;
};

export class Recorder {
    private stopFn: (() => void) | undefined;

    constructor(
        private readonly recordFn: RecordFn,
        getRecordConsolePlugin: typeof import('@rrweb/rrweb-plugin-console-record').getRecordConsolePlugin,
        private readonly buffer: IngestBuffer,
        config: UxrrConfig
    ) {
        try {
            const privacy = config.recording?.privacy;

            this.stopFn =
                recordFn({
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
        this.recordFn.takeFullSnapshot();
    }

    stop(): void {
        this.stopFn?.();
        this.stopFn = undefined;
    }
}

export async function createRecorder(buffer: IngestBuffer, config: UxrrConfig): Promise<Recorder> {
    const [{ record }, { getRecordConsolePlugin }] = await Promise.all([
        import('rrweb'),
        import('@rrweb/rrweb-plugin-console-record')
    ]);
    return new Recorder(record, getRecordConsolePlugin, buffer, config);
}
