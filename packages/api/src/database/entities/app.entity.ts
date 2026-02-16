import { BaseEntity } from '@zyno-io/dk-server-foundation';
import { entity, PrimaryKey, Unique } from '@deepkit/type';

@entity.name('apps')
export class AppEntity extends BaseEntity {
    id!: string & PrimaryKey;
    name!: string;
    origins: string[] = [];
    apiKey?: string & Unique;
    isActive: boolean = true;
    createdAt!: Date;
    updatedAt!: Date;
}
