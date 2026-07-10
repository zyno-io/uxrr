import { BaseEntity } from '@zyno-io/ts-server-foundation';
import { entity, PrimaryKey, Unique, UUID } from '@zyno-io/ts-server-foundation';

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
