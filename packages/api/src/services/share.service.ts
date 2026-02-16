import { randomUUID, createHmac, timingSafeEqual } from 'crypto';

import { HttpAccessDeniedError, HttpNotFoundError } from '@deepkit/http';

import { UxrrConfig } from '../config';
import { UxrrDatabase } from '../database/database';
import { ShareLinkEntity } from '../database/entities/share-link.entity';
import { SessionEntity } from '../database/entities/session.entity';

const SHARE_LINK_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

interface ShareTokenPayload {
    sid: string;
    exp: number;
    jti: string;
}

export class ShareService {
    constructor(
        private readonly config: UxrrConfig,
        private readonly db: UxrrDatabase
    ) {}

    private getSecret(): Buffer {
        if (!this.config.UXRR_SHARE_SECRET) {
            throw new Error('UXRR_SHARE_SECRET is required for share links');
        }
        return Buffer.from(this.config.UXRR_SHARE_SECRET, 'utf-8');
    }

    private sign(payload: ShareTokenPayload): string {
        const payloadJson = JSON.stringify(payload);
        const payloadB64 = Buffer.from(payloadJson).toString('base64url');
        const sig = createHmac('sha256', this.getSecret()).update(payloadB64).digest('base64url');
        return `${payloadB64}.${sig}`;
    }

    /**
     * Verify HMAC and expiry only — no database access.
     * Designed to reject bad tokens cheaply before any DB lookup.
     */
    verifyToken(token: string): ShareTokenPayload {
        const dotIdx = token.indexOf('.');
        if (dotIdx < 0) throw new HttpAccessDeniedError('Invalid share token');

        const payloadB64 = token.slice(0, dotIdx);
        const sigB64 = token.slice(dotIdx + 1);

        const expectedSig = createHmac('sha256', this.getSecret()).update(payloadB64).digest('base64url');

        if (sigB64.length !== expectedSig.length || !timingSafeEqual(Buffer.from(sigB64), Buffer.from(expectedSig))) {
            throw new HttpAccessDeniedError('Invalid share token');
        }

        let payload: ShareTokenPayload;
        try {
            payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
        } catch {
            throw new HttpAccessDeniedError('Invalid share token');
        }

        if (payload.exp * 1000 < Date.now()) {
            throw new HttpAccessDeniedError('Share link has expired');
        }

        return payload;
    }

    /**
     * Full validation: verify token cryptographically, then check DB for revocation.
     * Returns the sessionId.
     */
    async validateShareAccess(token: string): Promise<string> {
        const payload = this.verifyToken(token);

        const link = await this.db.query(ShareLinkEntity).filter({ id: payload.jti }).findOneOrUndefined();
        if (!link || link.revokedAt) {
            throw new HttpAccessDeniedError('Share link has been revoked');
        }

        return payload.sid;
    }

    async createShareLink(sessionId: string): Promise<{ token: string; expiresAt: Date; id: string }> {
        const session = await this.db.query(SessionEntity).filter({ id: sessionId }).findOneOrUndefined();
        if (!session) throw new HttpNotFoundError(`Session ${sessionId} not found`);

        await this.revokeActiveLink(sessionId);

        const jti = randomUUID();
        const expiresAt = new Date(Date.now() + SHARE_LINK_TTL_MS);

        const entity = new ShareLinkEntity();
        entity.id = jti;
        entity.sessionId = sessionId;
        entity.expiresAt = expiresAt;
        entity.createdAt = new Date();
        await this.db.persist(entity);

        const payload: ShareTokenPayload = {
            sid: sessionId,
            exp: Math.floor(expiresAt.getTime() / 1000),
            jti
        };

        return { token: this.sign(payload), expiresAt, id: jti };
    }

    async revokeActiveLink(sessionId: string): Promise<boolean> {
        const active = await this.db
            .query(ShareLinkEntity)
            .filter({ sessionId, revokedAt: undefined })
            .findOneOrUndefined();
        if (!active) return false;
        active.revokedAt = new Date();
        await this.db.persist(active);
        return true;
    }

    async getActiveLink(
        sessionId: string
    ): Promise<{ id: string; token: string; expiresAt: Date; createdAt: Date } | null> {
        const link = await this.db
            .query(ShareLinkEntity)
            .filter({ sessionId, revokedAt: undefined })
            .findOneOrUndefined();
        if (!link || link.expiresAt < new Date()) return null;
        const payload: ShareTokenPayload = {
            sid: sessionId,
            exp: Math.floor(link.expiresAt.getTime() / 1000),
            jti: link.id
        };
        return { id: link.id, token: this.sign(payload), expiresAt: link.expiresAt, createdAt: link.createdAt };
    }
}
