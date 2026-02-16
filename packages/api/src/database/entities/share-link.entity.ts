import { BaseEntity } from '@zyno-io/dk-server-foundation';
import { entity, Index, PrimaryKey, UUID } from '@deepkit/type';

@entity.name('share_links')
export class ShareLinkEntity extends BaseEntity {
    id!: UUID & PrimaryKey;
    sessionId!: UUID & Index;
    expiresAt!: Date;
    revokedAt?: Date;
    createdAt!: Date;
}
