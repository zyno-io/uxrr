import { BaseEntity } from '@zyno-io/dk-server-foundation';
import { entity, PrimaryKey, Unique } from '@deepkit/type';

@entity.name('api_keys')
export class ApiKeyEntity extends BaseEntity {
    id!: string & PrimaryKey;
    name!: string;
    keyPrefix!: string & Unique;
    keySecret!: string;
    scope!: string;
    appIds!: string[];
    isActive: boolean = true;
    createdAt!: Date;
    updatedAt!: Date;
}
