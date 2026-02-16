import { BaseEntity } from '@zyno-io/dk-server-foundation';
import { entity, Index, PrimaryKey } from '@deepkit/type';

@entity.name('share_links')
export class ShareLinkEntity extends BaseEntity {
    id!: string & PrimaryKey;
    sessionId!: string & Index;
    expiresAt!: Date;
    revokedAt?: Date;
    createdAt!: Date;
}
