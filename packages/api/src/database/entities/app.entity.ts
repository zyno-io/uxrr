import { entity, PrimaryKey, Unique, UUID } from '@zyno-io/ts-server-foundation';
import { BaseEntity } from '@zyno-io/ts-server-foundation';

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
