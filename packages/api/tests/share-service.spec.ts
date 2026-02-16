import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHmac } from 'crypto';

import { ShareService } from '../src/services/share.service';
import type { UxrrConfig } from '../src/config';
import type { UxrrDatabase } from '../src/database/database';

const SECRET = 'test-share-secret';

function makeConfig(): UxrrConfig {
    return { UXRR_SHARE_SECRET: SECRET } as UxrrConfig;
}

function signPayload(payload: object): string {
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', Buffer.from(SECRET, 'utf-8')).update(payloadB64).digest('base64url');
    return `${payloadB64}.${sig}`;
}

function makeDb(link?: { id: string; revokedAt?: Date }): UxrrDatabase {
    return {
        query: mock.fn(() => ({
            filter: mock.fn(function (this: unknown) {
                return this;
            }),
            findOneOrUndefined: mock.fn(async () => link),
            find: mock.fn(async () => (link ? [link] : [])),
            has: mock.fn(async () => !!link)
        })),
        persist: mock.fn(async () => {})
    } as unknown as UxrrDatabase;
}

describe('ShareService — token security', () => {
    describe('verifyToken', () => {
        it('accepts valid token with valid HMAC and future expiry', () => {
            const svc = new ShareService(makeConfig(), makeDb());
            const token = signPayload({
                sid: 'sess-1',
                exp: Math.floor(Date.now() / 1000) + 3600,
                jti: 'link-1'
            });

            const payload = svc.verifyToken(token);
            assert.equal(payload.sid, 'sess-1');
            assert.equal(payload.jti, 'link-1');
        });

        it('rejects tampered payload (HMAC mismatch)', () => {
            const svc = new ShareService(makeConfig(), makeDb());
            const validToken = signPayload({
                sid: 'sess-1',
                exp: Math.floor(Date.now() / 1000) + 3600,
                jti: 'link-1'
            });

            // Tamper with the payload part
            const [_payloadB64, sig] = validToken.split('.');
            const tamperedPayload = Buffer.from(
                JSON.stringify({
                    sid: 'sess-HACKED',
                    exp: Math.floor(Date.now() / 1000) + 3600,
                    jti: 'link-1'
                })
            ).toString('base64url');

            assert.throws(
                () => svc.verifyToken(`${tamperedPayload}.${sig}`),
                (err: Error) => {
                    assert.match(err.message, /Invalid share token/);
                    return true;
                }
            );
        });

        it('rejects expired token', () => {
            const svc = new ShareService(makeConfig(), makeDb());
            const token = signPayload({
                sid: 'sess-1',
                exp: Math.floor(Date.now() / 1000) - 60, // expired 1 min ago
                jti: 'link-1'
            });

            assert.throws(
                () => svc.verifyToken(token),
                (err: Error) => {
                    assert.match(err.message, /expired/);
                    return true;
                }
            );
        });

        it('rejects token with no dot separator', () => {
            const svc = new ShareService(makeConfig(), makeDb());

            assert.throws(
                () => svc.verifyToken('invalidtokenwithoutdot'),
                (err: Error) => {
                    assert.match(err.message, /Invalid share token/);
                    return true;
                }
            );
        });

        it('rejects token signed with wrong secret', () => {
            const wrongSecret = 'wrong-secret';
            const payloadB64 = Buffer.from(
                JSON.stringify({
                    sid: 'sess-1',
                    exp: Math.floor(Date.now() / 1000) + 3600,
                    jti: 'link-1'
                })
            ).toString('base64url');
            const wrongSig = createHmac('sha256', Buffer.from(wrongSecret, 'utf-8'))
                .update(payloadB64)
                .digest('base64url');

            const svc = new ShareService(makeConfig(), makeDb());

            assert.throws(
                () => svc.verifyToken(`${payloadB64}.${wrongSig}`),
                (err: Error) => {
                    assert.match(err.message, /Invalid share token/);
                    return true;
                }
            );
        });
    });

    describe('validateShareAccess', () => {
        it('rejects revoked share link', async () => {
            const db = makeDb({ id: 'link-1', revokedAt: new Date() });
            const svc = new ShareService(makeConfig(), db);
            const token = signPayload({
                sid: 'sess-1',
                exp: Math.floor(Date.now() / 1000) + 3600,
                jti: 'link-1'
            });

            await assert.rejects(
                () => svc.validateShareAccess(token),
                (err: Error) => {
                    assert.match(err.message, /revoked/);
                    return true;
                }
            );
        });

        it('rejects when share link not found in DB', async () => {
            const db = makeDb(undefined); // no link found
            const svc = new ShareService(makeConfig(), db);
            const token = signPayload({
                sid: 'sess-1',
                exp: Math.floor(Date.now() / 1000) + 3600,
                jti: 'link-1'
            });

            await assert.rejects(
                () => svc.validateShareAccess(token),
                (err: Error) => {
                    assert.match(err.message, /revoked/);
                    return true;
                }
            );
        });

        it('returns sessionId for valid, non-revoked link', async () => {
            const db = makeDb({ id: 'link-1' }); // active link (no revokedAt)
            const svc = new ShareService(makeConfig(), db);
            const token = signPayload({
                sid: 'sess-1',
                exp: Math.floor(Date.now() / 1000) + 3600,
                jti: 'link-1'
            });

            const sessionId = await svc.validateShareAccess(token);
            assert.equal(sessionId, 'sess-1');
        });
    });
});
