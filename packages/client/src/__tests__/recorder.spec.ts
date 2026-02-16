import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Recorder } from '../recording/recorder';
import type { IngestBuffer } from '../transport/ingest-buffer';
import type { UxrrConfig } from '../types';

const mockStop = vi.fn();
const mockTakeFullSnapshot = vi.fn();
const mockRecord = Object.assign(
    vi.fn((_opts: unknown) => {
        return mockStop;
    }),
    { takeFullSnapshot: mockTakeFullSnapshot }
);
const mockGetRecordConsolePlugin = vi.fn(() => ({ name: 'console-record' }));

function makeBuffer() {
    return { pushEvent: vi.fn() } as unknown as IngestBuffer;
}

function makeConfig(overrides: Partial<UxrrConfig> = {}): UxrrConfig {
    return {
        endpoint: 'https://example.com',
        appKey: 'app-1',
        ...overrides
    };
}

function makeRecorder(buffer?: IngestBuffer, config?: UxrrConfig): Recorder {
    return new Recorder(
        mockRecord as any,
        mockGetRecordConsolePlugin as any,
        buffer ?? makeBuffer(),
        config ?? makeConfig()
    );
}

/** Extract the emit callback from the most recent mockRecord call */
function getEmitCallback(): (event: unknown) => void {
    const lastCall = mockRecord.mock.calls[mockRecord.mock.calls.length - 1];
    return lastCall[0].emit;
}

describe('Recorder', () => {
    beforeEach(() => {
        mockRecord.mockClear();
        mockRecord.mockImplementation((_opts: unknown) => mockStop);
        mockStop.mockClear();
        mockTakeFullSnapshot.mockClear();
        mockGetRecordConsolePlugin.mockClear();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    describe('initialization', () => {
        it('calls rrweb record() on construction', () => {
            makeRecorder();
            expect(mockRecord).toHaveBeenCalledOnce();
        });

        it('passes emit callback that forwards events to buffer', () => {
            const buffer = makeBuffer();
            makeRecorder(buffer);

            const emitFn = getEmitCallback();
            const fakeEvent = { type: 3, data: {}, timestamp: 1000 };
            emitFn(fakeEvent);
            expect(buffer.pushEvent).toHaveBeenCalledWith(fakeEvent);
        });

        it('sets checkoutEveryNms to 120000', () => {
            makeRecorder();
            expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ checkoutEveryNms: 120_000 }));
        });
    });

    describe('privacy defaults', () => {
        it('masks all inputs by default', () => {
            makeRecorder();
            expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ maskAllInputs: true }));
        });

        it('does not mask text content by default', () => {
            makeRecorder();
            expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ maskTextSelector: undefined }));
        });

        it('respects maskTextContent = true override', () => {
            makeRecorder(
                undefined,
                makeConfig({
                    recording: { privacy: { maskTextContent: true } }
                })
            );
            expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ maskTextSelector: '*' }));
        });

        it('respects maskInputs = false override', () => {
            makeRecorder(
                undefined,
                makeConfig({
                    recording: { privacy: { maskInputs: false } }
                })
            );
            expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ maskAllInputs: false }));
        });

        it('respects maskTextContent = false override', () => {
            makeRecorder(
                undefined,
                makeConfig({
                    recording: { privacy: { maskTextContent: false } }
                })
            );
            expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ maskTextSelector: undefined }));
        });

        it('passes blockSelector from config', () => {
            makeRecorder(
                undefined,
                makeConfig({
                    recording: { privacy: { blockSelector: '.sensitive' } }
                })
            );
            expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ blockSelector: '.sensitive' }));
        });

        it('always masks password inputs', () => {
            makeRecorder();
            expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ maskInputOptions: { password: true } }));
        });
    });

    describe('takeFullSnapshot', () => {
        it('delegates to rrweb record.takeFullSnapshot', () => {
            const recorder = makeRecorder();
            recorder.takeFullSnapshot();
            expect(mockTakeFullSnapshot).toHaveBeenCalledOnce();
        });
    });

    describe('stop', () => {
        it('calls the stop function returned by rrweb record()', () => {
            const recorder = makeRecorder();
            recorder.stop();
            expect(mockStop).toHaveBeenCalledOnce();
        });

        it('can be called multiple times without error', () => {
            const recorder = makeRecorder();
            recorder.stop();
            expect(() => recorder.stop()).not.toThrow();
            // Second call should not call mockStop again since ref is nulled
            expect(mockStop).toHaveBeenCalledOnce();
        });
    });

    describe('error handling', () => {
        it('catches rrweb initialization errors and warns', () => {
            mockRecord.mockImplementationOnce(() => {
                throw new Error('DOM not ready');
            });
            expect(() => makeRecorder()).not.toThrow();
            expect(console.warn).toHaveBeenCalled();
        });

        it('stop is safe after failed initialization', () => {
            mockRecord.mockImplementationOnce(() => {
                throw new Error('fail');
            });
            const recorder = makeRecorder();
            expect(() => recorder.stop()).not.toThrow();
        });
    });

    describe('console plugin', () => {
        it('includes console record plugin', () => {
            makeRecorder();
            expect(mockGetRecordConsolePlugin).toHaveBeenCalled();
        });

        it('uses default console levels (warn, error, assert)', () => {
            makeRecorder();
            expect(mockGetRecordConsolePlugin).toHaveBeenCalledWith(
                expect.objectContaining({
                    level: ['warn', 'error', 'assert']
                })
            );
        });

        it('respects custom consoleLogLevel', () => {
            makeRecorder(
                undefined,
                makeConfig({
                    recording: { privacy: { consoleLogLevel: ['error'] } }
                })
            );
            expect(mockGetRecordConsolePlugin).toHaveBeenCalledWith(
                expect.objectContaining({
                    level: ['error']
                })
            );
        });
    });
});
