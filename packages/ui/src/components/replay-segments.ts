import type { eventWithTime } from '@rrweb/types';

export interface Segment {
    events: eventWithTime[];
    offsetMs: number;   // time from recording start to this segment's first real event
    durationMs: number; // last event timestamp − first event timestamp within this segment
}

/**
 * Split an event array into segments at FullSnapshot (type 2) boundaries.
 * Each segment is an independent rrweb recording that can be mounted separately.
 *
 * Sessions where the client refreshed during recording produce multiple FullSnapshots.
 * rrweb's Replayer cannot handle mid-stream FullSnapshot events — it tears down the
 * iframe DOM but fails to rebuild, producing a black screen. Splitting into segments
 * and replaying each independently avoids this.
 */
export function splitIntoSegments(events: eventWithTime[]): Segment[] {
    if (events.length === 0) return [];

    const groups: eventWithTime[][] = [];
    let current: eventWithTime[] = [];
    let hasSnapshot = false;

    for (const event of events) {
        if (event.type === 2 && hasSnapshot) {
            // New FullSnapshot — start a new segment.
            // If the preceding event is a Meta (type 4) it belongs with the new snapshot.
            const last = current[current.length - 1];
            if (last?.type === 4) {
                const meta = current.pop()!;
                if (current.length > 0) groups.push(current);
                current = [meta, event];
            } else {
                if (current.length > 0) groups.push(current);
                current = [event];
            }
        } else {
            if (event.type === 2) hasSnapshot = true;
            current.push(event);
        }
    }
    if (current.length > 0) groups.push(current);

    const recStart = events[0]!.timestamp;
    return groups.map(segEvents => ({
        events: segEvents,
        offsetMs: segEvents[0]!.timestamp - recStart,
        durationMs: segEvents[segEvents.length - 1]!.timestamp - segEvents[0]!.timestamp
    }));
}

/**
 * Pad a segment with synthetic Custom events at recording boundaries so
 * rrweb-player's built-in controller shows the full recording timeline.
 *
 * Without padding, each segment's controller would only show that segment's
 * duration. With padding, the user sees a continuous timeline and can seek
 * across segments using rrweb's built-in controller.
 */
export function padSegmentEvents(
    seg: Segment,
    recordingStartTs: number,
    recordingEndTs: number
): eventWithTime[] {
    const padded = [...seg.events];
    const segStart = seg.events[0]!.timestamp;
    const segEnd = seg.events[seg.events.length - 1]!.timestamp;

    if (segStart > recordingStartTs) {
        padded.unshift({
            type: 5,
            data: { tag: 'uxrr:segment-pad', payload: {} },
            timestamp: recordingStartTs
        } as unknown as eventWithTime);
    }
    if (segEnd < recordingEndTs) {
        padded.push({
            type: 5,
            data: { tag: 'uxrr:segment-pad', payload: {} },
            timestamp: recordingEndTs
        } as unknown as eventWithTime);
    }
    return padded;
}

/**
 * Filter out malformed events that would crash rrweb-player's Replayer constructor.
 * IncrementalSnapshot events (type 3) MUST have a data object with a source property;
 * indicatesTouchDevice() in rrweb reads e.data.source without a null check.
 */
export function filterValidEvents(events: eventWithTime[]): eventWithTime[] {
    return events.filter(e => {
        if (!e || typeof e !== 'object') return false;
        if (typeof e.type !== 'number' || typeof e.timestamp !== 'number') return false;
        if (e.type === 3) {
            return !!(e.data && typeof e.data === 'object' && 'source' in (e.data as object));
        }
        return true;
    });
}

/** Find which segment a given recording-relative time offset falls in. */
export function findSegmentForTime(segments: Segment[], timeOffsetMs: number): number {
    for (let i = segments.length - 1; i >= 0; i--) {
        if (timeOffsetMs >= segments[i]!.offsetMs) return i;
    }
    return 0;
}
