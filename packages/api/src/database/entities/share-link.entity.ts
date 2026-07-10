import { BaseEntity } from '@zyno-io/ts-server-foundation';
import { entity, Index, PrimaryKey, UUID } from '@zyno-io/ts-server-foundation';

@entity.name('share_links')
export class ShareLinkEntity extends BaseEntity {
    id!: UUID & PrimaryKey;
    sessionId!: UUID & Index;
    expiresAt!: Date;
    revokedAt?: Date;
    createdAt!: Date;
}
