import { BaseEntity } from '@zyno-io/dk-server-foundation';
import { entity, Index, PrimaryKey } from '@deepkit/type';

@entity.name('sessions')
export class SessionEntity extends BaseEntity {
    id!: string & PrimaryKey;
    appId!: string & Index;
    deviceId!: string & Index;
    userId?: string & Index;
    userName?: string;
    userEmail?: string;
    version?: string;
    environment?: string;
    userAgent?: string;
    ipAddress?: string;
    startedAt!: Date;
    lastActivityAt!: Date;
    eventChunkCount: number = 0;
    eventBytesStored: number = 0;
    hasChatMessages: boolean = false;
    createdAt!: Date;
    updatedAt!: Date;
}
