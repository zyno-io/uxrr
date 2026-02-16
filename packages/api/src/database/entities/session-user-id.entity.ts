import { entity, Index, PrimaryKey, UUID } from '@deepkit/type';

@entity.name('session_user_ids')
export class SessionUserIdEntity {
    sessionId!: UUID & PrimaryKey;
    userId!: string & PrimaryKey & Index;
}
