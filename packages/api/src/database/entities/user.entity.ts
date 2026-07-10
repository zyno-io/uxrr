import { BaseEntity } from '@zyno-io/ts-server-foundation';
import { entity, Index, PrimaryKey, Unique, UUID } from '@zyno-io/ts-server-foundation';

@entity.name('users')
export class UserEntity extends BaseEntity {
    id!: UUID & PrimaryKey;
    oidcSub!: string & Unique;
    email!: string & Index;
    name?: string;
    isAdmin: boolean = false;
    lastLoginAt!: Date;
    createdAt!: Date;
    updatedAt!: Date;
}
