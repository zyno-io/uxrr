import { entity, PrimaryKey, Unique, UUID } from '@deepkit/type';
import { BaseEntity } from '@zyno-io/dk-server-foundation';

@entity.name('apps')
export class AppEntity extends BaseEntity {
    id!: UUID & PrimaryKey;
    appKey!: string & Unique;
    name!: string;
    origins: string[] = [];
    apiKey?: string & Unique;
    isActive: boolean = true;
    maxIdleTimeout?: number;
    maxSessionDuration?: number;
    createdAt!: Date;
    updatedAt!: Date;
}
