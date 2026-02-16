import { createPostgresDatabase } from '@zyno-io/dk-server-foundation';

import { ApiKeyEntity } from './entities/api-key.entity';
import { AppEntity } from './entities/app.entity';
import { SessionUserIdEntity } from './entities/session-user-id.entity';
import { SessionEntity } from './entities/session.entity';
import { ShareLinkEntity } from './entities/share-link.entity';
import { UserEntity } from './entities/user.entity';

export class UxrrDatabase extends createPostgresDatabase({}, [
    SessionEntity,
    SessionUserIdEntity,
    AppEntity,
    ShareLinkEntity,
    ApiKeyEntity,
    UserEntity
]) {}
