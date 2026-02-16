import { BaseEntity } from '@zyno-io/dk-server-foundation';
import { entity, PrimaryKey, Unique, UUID } from '@deepkit/type';

@entity.name('api_keys')
export class ApiKeyEntity extends BaseEntity {
    id!: UUID & PrimaryKey;
    name!: string;
    keyPrefix!: string & Unique;
    keySecret!: string;
    scope!: string;
    appKeys!: string[];
    isActive: boolean = true;
    createdAt!: Date;
    updatedAt!: Date;
}
