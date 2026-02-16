import { describe, it, afterEach, mock } from 'node:test';
import { strict as assert } from 'node:assert';

import { RateLimiter } from '../src/util/rate-limiter';

describe('RateLimiter', () => {
    let limiter: RateLimiter | undefined;

    afterEach(() => {
        limiter?.stop();
        limiter = undefined;
        mock.timers.reset();
    });

    it('allows requests within the limit', () => {
        limiter = new RateLimiter(3, 1_000);
        assert.equal(limiter.isAllowed('a'), true);
        assert.equal(limiter.isAllowed('a'), true);
        assert.equal(limiter.isAllowed('a'), true);
    });

    it('rejects requests exceeding the limit', () => {
        limiter = new RateLimiter(2, 1_000);
        assert.equal(limiter.isAllowed('a'), true);
        assert.equal(limiter.isAllowed('a'), true);
        assert.equal(limiter.isAllowed('a'), false);
    });

    it('tracks keys independently', () => {
        limiter = new RateLimiter(1, 1_000);
        assert.equal(limiter.isAllowed('a'), true);
        assert.equal(limiter.isAllowed('b'), true);
        assert.equal(limiter.isAllowed('a'), false);
        assert.equal(limiter.isAllowed('b'), false);
    });

    it('allows requests again after the window expires', () => {
        mock.timers.enable({ apis: ['Date'] });
        limiter = new RateLimiter(1, 1_000);

        assert.equal(limiter.isAllowed('a'), true);
        assert.equal(limiter.isAllowed('a'), false);

        // Advance past the window
        mock.timers.tick(1_001);

        assert.equal(limiter.isAllowed('a'), true);
    });

    it('handles sliding window correctly', () => {
        mock.timers.enable({ apis: ['Date'] });
        limiter = new RateLimiter(2, 1_000);

        assert.equal(limiter.isAllowed('a'), true); // t=0
        mock.timers.tick(500);
        assert.equal(limiter.isAllowed('a'), true); // t=500
        assert.equal(limiter.isAllowed('a'), false); // t=500, limit reached

        mock.timers.tick(501); // t=1001, first request expired
        assert.equal(limiter.isAllowed('a'), true); // allowed again (only 1 in window now)
        assert.equal(limiter.isAllowed('a'), false); // back to limit
    });
});
