import { BaseEntity } from '@zyno-io/dk-server-foundation';
import { entity, PrimaryKey, Unique, UUID } from '@deepkit/type';

@entity.name('apps')
export class AppEntity extends BaseEntity {
    id!: UUID & PrimaryKey;
    appKey!: string & Unique;
    name!: string;
    origins: string[] = [];
    apiKey?: string & Unique;
    isActive: boolean = true;
    createdAt!: Date;
    updatedAt!: Date;
}
