import { entity, Index, PrimaryKey, UUID } from '@zyno-io/ts-server-foundation';

@entity.name('session_user_ids')
export class SessionUserIdEntity {
    sessionId!: UUID & PrimaryKey;
    userId!: string & PrimaryKey & Index;
}
