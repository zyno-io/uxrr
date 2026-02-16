import { describe, it, expect } from 'vitest';
import {
    splitIntoSegments,
    padSegmentEvents,
    filterValidEvents,
    findSegmentForTime
} from '@/components/replay-segments';
import type { eventWithTime } from '@rrweb/types';

function ev(type: number, timestamp: number, data?: unknown): eventWithTime {
    return { type, timestamp, data: data ?? {} } as unknown as eventWithTime;
}

describe('replay-segments', () => {
    describe('splitIntoSegments', () => {
        it('returns single segment when no mid-stream FullSnapshot', () => {
            const events = [
                ev(4, 1000, { width: 800, height: 600 }),
                ev(2, 1001),
                ev(3, 1100, { source: 0 }),
                ev(3, 1200, { source: 1 })
            ];
            const segments = splitIntoSegments(events);
            expect(segments).toHaveLength(1);
            expect(segments[0]!.events).toHaveLength(4);
            expect(segments[0]!.offsetMs).toBe(0);
            expect(segments[0]!.durationMs).toBe(200);
        });

        it('splits at second FullSnapshot', () => {
            const events = [
                ev(4, 1000, { width: 800, height: 600 }),
                ev(2, 1001),
                ev(3, 1100, { source: 0 }),
                // Client refresh — new Meta + FullSnapshot
                ev(4, 2000, { width: 1024, height: 768 }),
                ev(2, 2001),
                ev(3, 2100, { source: 1 })
            ];
            const segments = splitIntoSegments(events);
            expect(segments).toHaveLength(2);

            // Segment 1: Meta + FS + Incr
            expect(segments[0]!.events).toHaveLength(3);
            expect(segments[0]!.offsetMs).toBe(0);
            expect(segments[0]!.durationMs).toBe(100); // 1100 - 1000

            // Segment 2: Meta + FS + Incr (Meta moved from end of segment 1)
            expect(segments[1]!.events).toHaveLength(3);
            expect(segments[1]!.events[0]!.type).toBe(4); // Meta
            expect(segments[1]!.events[1]!.type).toBe(2); // FullSnapshot
            expect(segments[1]!.offsetMs).toBe(1000); // 2000 - 1000
            expect(segments[1]!.durationMs).toBe(100); // 2100 - 2000
        });

        it('handles multiple refreshes', () => {
            const events = [
                ev(4, 1000), ev(2, 1001), ev(3, 1500, { source: 0 }),
                ev(4, 2000), ev(2, 2001), ev(3, 2500, { source: 0 }),
                ev(4, 3000), ev(2, 3001), ev(3, 3500, { source: 0 })
            ];
            const segments = splitIntoSegments(events);
            expect(segments).toHaveLength(3);
            expect(segments[0]!.offsetMs).toBe(0);
            expect(segments[1]!.offsetMs).toBe(1000);
            expect(segments[2]!.offsetMs).toBe(2000);
        });

        it('handles FullSnapshot without preceding Meta', () => {
            const events = [
                ev(4, 1000), ev(2, 1001), ev(3, 1100, { source: 0 }),
                // Refresh but FullSnapshot arrives without Meta
                ev(2, 2001),
                ev(3, 2100, { source: 0 })
            ];
            const segments = splitIntoSegments(events);
            expect(segments).toHaveLength(2);
            expect(segments[1]!.events[0]!.type).toBe(2); // FullSnapshot, no Meta
        });

        it('returns empty array for empty events', () => {
            expect(splitIntoSegments([])).toHaveLength(0);
        });
    });

    describe('padSegmentEvents', () => {
        it('pads start and end when segment does not span full recording', () => {
            const seg = {
                events: [ev(4, 2000), ev(2, 2001), ev(3, 2500, { source: 0 })],
                offsetMs: 1000,
                durationMs: 500
            };
            const padded = padSegmentEvents(seg, 1000, 3500);

            // Start pad
            expect(padded[0]!.type).toBe(5);
            expect(padded[0]!.timestamp).toBe(1000);

            // Original events in the middle
            expect(padded[1]!.type).toBe(4);
            expect(padded[2]!.type).toBe(2);
            expect(padded[3]!.type).toBe(3);

            // End pad
            expect(padded[4]!.type).toBe(5);
            expect(padded[4]!.timestamp).toBe(3500);
        });

        it('does not pad when segment already spans full recording', () => {
            const seg = {
                events: [ev(4, 1000), ev(2, 1001), ev(3, 3500, { source: 0 })],
                offsetMs: 0,
                durationMs: 2500
            };
            const padded = padSegmentEvents(seg, 1000, 3500);
            expect(padded).toHaveLength(3); // no pads added
        });

        it('only pads end for first segment', () => {
            const seg = {
                events: [ev(4, 1000), ev(2, 1001), ev(3, 1500, { source: 0 })],
                offsetMs: 0,
                durationMs: 500
            };
            const padded = padSegmentEvents(seg, 1000, 3500);
            expect(padded).toHaveLength(4); // 3 original + 1 end pad
            expect(padded[0]!.type).toBe(4); // first event unchanged (no start pad)
            expect(padded[3]!.type).toBe(5); // end pad
        });
    });

    describe('filterValidEvents', () => {
        it('keeps well-formed events', () => {
            const events = [
                ev(4, 1000, { width: 800 }),
                ev(2, 1001),
                ev(3, 1100, { source: 0 })
            ];
            expect(filterValidEvents(events)).toHaveLength(3);
        });

        it('removes events without type or timestamp', () => {
            const events = [
                { type: 2 } as unknown as eventWithTime, // no timestamp
                { timestamp: 1000 } as unknown as eventWithTime, // no type
                null as unknown as eventWithTime,
                ev(2, 1001) // valid
            ];
            expect(filterValidEvents(events)).toHaveLength(1);
        });

        it('removes IncrementalSnapshot without source', () => {
            const events = [
                ev(3, 1000, { source: 0 }), // valid
                ev(3, 1001, {}), // missing source
                ev(3, 1002, null) // null data
            ];
            expect(filterValidEvents(events)).toHaveLength(1);
        });
    });

    describe('findSegmentForTime', () => {
        const segments = [
            { events: [], offsetMs: 0, durationMs: 1000 },
            { events: [], offsetMs: 1000, durationMs: 1000 },
            { events: [], offsetMs: 2000, durationMs: 1000 }
        ] as unknown as import('@/components/replay-segments').Segment[];

        it('returns 0 for time before first segment', () => {
            expect(findSegmentForTime(segments, -100)).toBe(0);
        });

        it('returns correct segment for time within a segment', () => {
            expect(findSegmentForTime(segments, 500)).toBe(0);
            expect(findSegmentForTime(segments, 1500)).toBe(1);
            expect(findSegmentForTime(segments, 2500)).toBe(2);
        });

        it('returns segment at boundary (inclusive start)', () => {
            expect(findSegmentForTime(segments, 1000)).toBe(1);
            expect(findSegmentForTime(segments, 2000)).toBe(2);
        });

        it('returns last segment for time beyond all segments', () => {
            expect(findSegmentForTime(segments, 5000)).toBe(2);
        });
    });
});
