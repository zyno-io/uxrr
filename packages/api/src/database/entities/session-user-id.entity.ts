import { entity, Index, PrimaryKey } from '@deepkit/type';

@entity.name('session_user_ids')
export class SessionUserIdEntity {
    sessionId!: string & PrimaryKey;
    userId!: string & PrimaryKey & Index;
}
