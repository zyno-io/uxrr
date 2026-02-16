import { BaseEntity } from '@zyno-io/dk-server-foundation';
import { entity, Index, PrimaryKey, Unique, UUID } from '@deepkit/type';

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
