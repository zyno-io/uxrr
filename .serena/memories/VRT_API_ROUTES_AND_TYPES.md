# UXRR VRT Mock Fixtures Guide

Complete reference for building Visual Regression Testing (VRT) mock fixtures for the UXRR platform.

---

## UI Routes

### Main Routes (Vue Router)
- `/` → SessionList (sessions page)
- `/sessions/:id` → SessionDetail (session replay page)
- `/share/:token` → SharedSessionDetail (public shared session)
- `/embed` → EmbedSessionList (embedded sessions list)
- `/embed/:id` → EmbedSessionDetail (embedded session replay)
- `/admin/apps` → AdminApps (manage applications)
- `/admin/users` → AdminUsers (manage users)
- `/admin/api-keys` → AdminApiKeys (manage API keys)
- `/auth/callback` → Auth callback handler

### Admin Routes
Protected by `meta: { admin: true }` — redirects to `/` if not admin.

---

## REST API Endpoints

All endpoints are in OpenAPI format at `packages/api/openapi.yaml`.

### Admin Endpoints

#### Apps Management
- **GET /v1/admin/apps** → `AppResponse[]`
- **POST /v1/admin/apps** → `AppResponse` (body: `CreateAppBody`)
- **PATCH /v1/admin/apps/{id}** → `AppResponse` (body: `UpdateAppBody`)
- **DELETE /v1/admin/apps/{id}** → `{ ok: boolean }`

#### Users Management
- **GET /v1/admin/users** → `UserResponse[]`
- **PATCH /v1/admin/users/{id}** → `UserResponse` (body: `UpdateUserBody`)

#### API Keys Management
- **GET /v1/api-keys** → `ApiKeyResponse[]`
- **POST /v1/api-keys** → `CreateApiKeyResponse` (body: `CreateApiKeyBody`)
- **GET /v1/api-keys/{id}** → `ApiKeyResponse`
- **PATCH /v1/api-keys/{id}** → `ApiKeyResponse` (body: `UpdateApiKeyBody`)
- **DELETE /v1/api-keys/{id}** → `{ ok: boolean }`
- **POST /v1/api-keys/sign** → `{ token: string }` (body: `SignTokenBody`)

### Auth Endpoints

- **GET /v1/auth/config** → `AuthConfigResponse`
- **GET /v1/auth/me** → `MeResponse`

### Session Endpoints

#### Session List & Query
- **GET /v1/sessions** → `ISession[]`
  - Query params: `appId`, `userId`, `deviceId`, `from`, `to`, `hasChat`, `limit`, `offset`
- **GET /v1/sessions/autocomplete/appIds** → `string[]`
- **GET /v1/sessions/autocomplete/deviceIds** → `string[]`
- **GET /v1/sessions/autocomplete/users** → `{ userId: string; userName?: string; userEmail?: string }[]`

#### Session Detail
- **GET /v1/sessions/{id}** → `ISession`
- **DELETE /v1/sessions/{id}** → `{ ok: boolean }`

#### Session Data
- **GET /v1/sessions/{id}/events** → `IRrwebEvent[]`
- **GET /v1/sessions/{id}/logs** → `ILogEntry[]`
- **GET /v1/sessions/{id}/chat** → `IChatMessage[]`

#### Share Links
- **GET /v1/sessions/{id}/share** → `{ active: boolean; token?: string; expiresAt?: string; createdAt?: string }`
- **POST /v1/sessions/{id}/share** → `{ token: string; expiresAt: string; id: string }`
- **DELETE /v1/sessions/{id}/share** → `{ ok: boolean }`

### Shared Session Endpoints

- **GET /v1/shared/{token}** → `IShareSession`
- **GET /v1/shared/{token}/events** → `unknown[]`
- **GET /v1/shared/{token}/logs** → `unknown[]`
- **GET /v1/shared/{token}/chat** → `unknown[]`

### Health Check

- **GET /healthz** → `{ version: string }`

### Ingest Endpoints (Data Collection)

- **POST /v1/ng/{appId}/{sessionId}/data** → `{ ok: true; ws?: boolean }`
- **POST /v1/ng/{appId}/{sessionId}/t** → `{}`

---

## Type Definitions

All types are auto-generated from OpenAPI. Source: `packages/ui/src/openapi-client-generated/types.gen.ts`

### Core Types

#### AppResponse
```typescript
type AppResponse = {
    id: string;
    name: string;
    origins: Array<string>;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
};
```

#### CreateAppBody
```typescript
type CreateAppBody = {
    id?: string;
    name: string;
    origins: Array<string>;
};
```

#### UpdateAppBody
```typescript
type UpdateAppBody = {
    name?: string;
    origins?: Array<string>;
    isActive?: boolean;
};
```

#### UserResponse
```typescript
type UserResponse = {
    id: string;
    email: string;
    name?: string;
    isAdmin: boolean;
    lastLoginAt: string;
    createdAt: string;
};
```

#### UpdateUserBody
```typescript
type UpdateUserBody = {
    isAdmin: boolean;
};
```

#### MeResponse
```typescript
type MeResponse = {
    userId?: string;
    userName?: string;
    userEmail?: string;
    scope: string;
    isAdmin: boolean;
};
```

#### AuthConfigResponse
```typescript
type AuthConfigResponse = {
    oidc: OidcConfig | null;
    grafana: GrafanaConfig | null;
};
```

#### OidcConfig
```typescript
type OidcConfig = {
    issuerUrl: string;
    clientId: string;
    scopes: string;
};
```

#### GrafanaConfig
```typescript
type GrafanaConfig = {
    baseUrl: string;
    datasource: string;
};
```

### Session Types

#### ISession
```typescript
type ISession = {
    id: string;
    appId: string;
    deviceId: string;
    userId?: string;
    userName?: string;
    userEmail?: string;
    version?: string;
    environment?: string;
    userAgent?: string;
    ipAddress?: string;
    startedAt: string;
    lastActivityAt: string;
    eventChunkCount: number;
    hasChatMessages: boolean;
    createdAt: string;
    updatedAt: string;
    allUserIds: Array<string>;
    isLive: boolean;
};
```

#### IShareSession
```typescript
type IShareSession = {
    id: string;
    appId: string;
    deviceId: string;
    userId?: string;
    userName?: string;
    userEmail?: string;
    version?: string;
    environment?: string;
    userAgent?: string;
    ipAddress?: string;
    startedAt: string;
    lastActivityAt: string;
    eventChunkCount: number;
    hasChatMessages: boolean;
    createdAt: string;
    updatedAt: string;
    allUserIds: Array<string>;
    isLive: boolean;
};
```

### Event & Log Types

#### IRrwebEvent
```typescript
type IRrwebEvent = {
    type: number;
    data: unknown;
    timestamp: number;
    delay?: number;
};
```

#### RrwebEvent (ingest format)
```typescript
type RrwebEvent = {
    type: number;
    data: unknown;
    timestamp: number;
    delay?: number;
};
```

#### ILogEntry (retrieved format)
```typescript
type ILogEntry = {
    t: number;        // timestamp (unix ms)
    v: number;        // level (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR)
    c: string;        // scope/category (e.g., 'uxrr:net')
    m: string;        // message
    d?: unknown;      // data (optional)
    appId: string;
    deviceId: string;
    userId?: string;
    sessionId: string;
};
```

#### IngestLogEntry (ingest format)
```typescript
type IngestLogEntry = {
    t: number;
    v: number;
    c: string;
    m: string;
    d?: unknown;
};
```

#### IChatMessage
```typescript
type IChatMessage = {
    message: string;
    from: string;     // 'user', 'agent', or '__separator'
    timestamp: number;
};
```

### API Key Types

#### ApiKeyResponse
```typescript
type ApiKeyResponse = {
    id: string;
    name: string;
    keyPrefix: string;
    scope: string;
    appIds: Array<string>;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
};
```

#### CreateApiKeyBody
```typescript
type CreateApiKeyBody = {
    name: string;
    scope: 'readonly' | 'interactive';
    appIds: Array<string>;
};
```

#### UpdateApiKeyBody
```typescript
type UpdateApiKeyBody = {
    name?: string;
    scope?: 'readonly' | 'interactive';
    appIds?: Array<string>;
    isActive?: boolean;
};
```

#### SignTokenBody
```typescript
type SignTokenBody = {
    exp: number;
    scope: 'readonly' | 'interactive';
    apps: Array<string>;
    sid?: string;
};
```

### Ingest Types

#### IngestDataPayload
```typescript
type IngestDataPayload = {
    identity: {
        deviceId?: string;
        userId?: string;
        userName?: string;
        userEmail?: string;
    };
    meta: {
        version?: string;
        environment?: string;
        userAgent?: string;
    };
    launchTs: number;
    events?: Array<RrwebEvent>;
    logs?: Array<IngestLogEntry>;
};
```

---

## WebSocket Messages

WebSocket connections are used for real-time updates. All messages are JSON.

### Session List Stream

**URL:** `ws://localhost:8978/v1/sessions/watch?token=...&appId=...&userId=...&deviceId=...&from=...&to=...`

**Client → Server:**
```typescript
{ type: 'set_filters'; filters: SessionListFilters }
```

**Server → Client:**

#### Session Created
```typescript
{ type: 'session_created'; session: ISession }
```

#### Session Updated
```typescript
{ type: 'session_updated'; session: ISession }
```

#### Session Live Status
```typescript
{ type: 'session_live_status'; sessionId: string; isLive: boolean; lastActivityAt: string }
```

### Live Session Stream

**URL:** `ws://localhost:8978/v1/sessions/{sessionId}/live?token=...`

**Client → Server:**
```typescript
// Cursor/pointer control
{ type: 'cursor'; x: number; y: number }
{ type: 'remote_click'; x: number; y: number }
{ type: 'cursor_hide' }

// Highlighting
{ type: 'highlight'; x: number; y: number }

// Pen tool
{ type: 'pen_start'; x: number; y: number }
{ type: 'pen_move'; x: number; y: number }
{ type: 'pen_end' }

// Control
{ type: 'take_control' }

// Chat
{ type: 'start_chat' }
{ type: 'chat'; message: string }
{ type: 'end_chat' }
{ type: 'typing' }
```

**Server → Client:**

#### Events
```typescript
{ type: 'events'; data: unknown[] }
```

#### Logs
```typescript
{ type: 'logs'; data: ILogEntry[] }
```

#### Chat Message
```typescript
{ type: 'chat'; message: string; from?: string }
```

#### Typing Indicator
```typescript
{ type: 'typing' }
```

#### Focus Change
```typescript
{ type: 'focus'; focused: boolean }
```

#### Client Connection Status
```typescript
{ type: 'client_connected' }
{ type: 'client_disconnected' }
```

#### Control Grant/Revoke
```typescript
{ type: 'control_granted' }
{ type: 'control_revoked' }
```

#### Agents List
```typescript
{ type: 'agents_updated'; agents: AgentInfo[] }
```

#### Chat Status
```typescript
{ type: 'start_chat' }
{ type: 'end_chat' }
```

#### Pen Events from Client
```typescript
{ type: 'pen_start'; x: number; y: number }
{ type: 'pen_move'; x: number; y: number }
{ type: 'pen_end' }
```

### AgentInfo Type
```typescript
interface AgentInfo {
    id: string;
    email: string;
    name?: string;
    isController: boolean;
}
```

---

## Console Panel Log Entry Structure

**Log Level Values:**
```typescript
const LOG_LEVELS: Record<number, { label: string; cssClass: string }> = {
    0: { label: 'DEBUG', cssClass: 'level-debug' },
    1: { label: 'INFO', cssClass: 'level-info' },
    2: { label: 'WARN', cssClass: 'level-warn' },
    3: { label: 'ERROR', cssClass: 'level-error' }
};
```

**Network Entry Format (in log `d` field):**
```typescript
interface NetworkData {
    method: string;
    url: string;
    status: number;
    duration: number;
    traceId?: string;
    requestHeaders?: Record<string, string>;
    requestBody?: string;
    responseHeaders?: Record<string, string>;
    responseBody?: string;
}
```

Network entries are logged with scope `'uxrr:net'`.

---

## State Management

### Auth State (Reactive)

**Source:** `packages/ui/src/auth.ts`

```typescript
interface AuthState {
    initialized: boolean;
    oidcEnabled: boolean;
    user: User | null;          // OIDC User from oidc-client-ts
    error: string | null;
    me: MeResponse | null;
}

export const authState = reactive<AuthState>({...});
export const isAdmin = computed(() => authState.me?.isAdmin === true);
export const grafanaConfig = ref<GrafanaConfig | null>(null);
```

### useSessionDetail Composable

**Source:** `packages/ui/src/composables/useSessionDetail.ts`

Returns comprehensive session detail state with layout management, live streaming, and player control:

```typescript
interface SessionDetailReturn {
    // State
    session: Ref<ISession | null>;
    logs: Ref<ILogEntry[]>;
    chatMessages: Ref<ChatMessage[]>;
    loading: Ref<boolean>;
    error: Ref<string | null>;
    currentTimeMs: Ref<number>;
    activeTab: Ref<'console' | 'network' | 'chat'>;
    isLive: Ref<boolean>;
    clientConnected: Ref<boolean>;
    chatStarted: Ref<boolean>;
    chatActive: Ref<boolean>;
    userTyping: Ref<boolean>;
    clientFocused: Ref<boolean>;
    hasControl: Ref<boolean>;

    // Layout
    layout: Ref<'right' | 'bottom'>;
    sidePaneSize: Ref<number>;
    isResizing: Ref<boolean>;

    // Computed
    sessionStartMs: ComputedRef<number>;
    consoleLogs: ComputedRef<ILogEntry[]>;
    networkLogs: ComputedRef<ILogEntry[]>;
    showChatTab: ComputedRef<boolean | undefined>;
    liveStatus: ComputedRef<'ended' | 'waiting' | 'syncing' | 'live' | null>;
    playbackTime: ComputedRef<Date | null>;
    livePlayerReady: Ref<boolean>;
    clientEverConnected: Ref<boolean>;

    // Actions
    toggleLayout: () => void;
    startResize: (e: MouseEvent) => void;
    skipLive: () => Promise<void>;
    onTimeUpdate: (ms: number) => void;
    seekTo: (offsetMs: number) => void;
    formatLocal: (d: Date) => string;
    formatUtc: (d: Date) => string;
    formatMeta: (s: ISession) => string;
    getLiveStream: () => LiveStreamHandle | null;
}
```

**Console Logs Filter:** `logs.value.filter(l => !!l)` (all logs pass through; ConsolePanel handles Net toggle internally)

**Network Logs Filter:** `logs.value.filter(l => l.c === 'uxrr:net')`

---

## Component Props & Events

### ConsolePanel
```typescript
defineProps<{
    logs: ILogEntry[];
    currentTimeMs: number;
    sessionStartMs: number;
    grafana?: GrafanaConfig | null;
}>();

defineEmits<{
    seek: [offsetMs: number];
}>();
```

### NetworkPanel
```typescript
defineProps<{
    entries: ILogEntry[];
    currentTimeMs: number;
    sessionStartMs: number;
    grafana?: GrafanaConfig | null;
}>();

defineEmits<{
    seek: [offsetMs: number];
}>();

interface NetworkData {
    method: string;
    url: string;
    status: number;
    duration: number;
    traceId?: string;
    requestHeaders?: Record<string, string>;
    requestBody?: string;
    responseHeaders?: Record<string, string>;
    responseBody?: string;
}
```

### ChatPanel
```typescript
interface ChatMessage {
    message: string;
    from: string;
    timestamp: number;
}

defineProps<{
    messages: ChatMessage[];
    chatStarted: boolean;
    chatActive: boolean;
    clientConnected: boolean;
    userTyping: boolean;
    readonly?: boolean;
}>();

defineEmits<{
    send: [message: string];
    'start-chat': [];
    'end-chat': [];
    typing: [];
}>();
```

---

## Page Component API Usage

### AdminApps.vue
- **Load:** `AdminApi.getAdminListApps()` → `AppResponse[]`
- **Create:** `AdminApi.postAdminCreateApp({ body: CreateAppBody })` → `AppResponse`
- **Edit:** `AdminApi.patchAdminUpdateApp({ path: { id }, body: UpdateAppBody })` → `AppResponse`
- **Deactivate:** `AdminApi.deleteAdminDeactivateApp({ path: { id } })` → `{ ok: boolean }`
- **Activate:** `AdminApi.patchAdminUpdateApp({ path: { id }, body: { isActive: true } })` → `AppResponse`

### AdminUsers.vue
- **Load:** `AdminApi.getAdminListUsers()` → `UserResponse[]`
- **Update:** `AdminApi.patchAdminUpdateUser({ path: { id }, body: UpdateUserBody })` → `UserResponse`

### AdminApiKeys.vue
- **Load Keys:** `ApiKeyApi.getApiKeyListKeys()` → `ApiKeyResponse[]`
- **Load Apps:** `AdminApi.getAdminListApps()` → `AppResponse[]`
- **Create Key:** `ApiKeyApi.postApiKeyCreateKey({ body: CreateApiKeyBody })` → `{ id, name, keyPrefix, scope, appIds, isActive, createdAt, updatedAt, key }`
- **Revoke Key:** `ApiKeyApi.deleteApiKeyRevokeKey({ path: { id } })` → `{ ok: boolean }`

### SessionList.vue
- **Load Sessions:** `SessionApi.getSessionListSessions({ query: filters })` → `ISession[]`
- **WebSocket:** `connectSessionListStream(filters, callbacks)` for real-time updates

### SessionDetail.vue
- **Load Session:** `SessionApi.getSessionGetSession({ path: { id } })` → `ISession`
- **Load Events:** `SessionApi.getSessionGetSessionEvents({ path: { id } })` → `IRrwebEvent[]`
- **Load Logs:** `SessionApi.getSessionGetSessionLogs({ path: { id } })` → `ILogEntry[]`
- **Load Chat:** `SessionApi.getSessionGetSessionChat({ path: { id } })` → `IChatMessage[]`
- **Get Share Link:** `SessionApi.getSessionGetShareLink({ path: { id } })` → `{ active, token?, expiresAt?, createdAt? }`
- **Create Share:** `SessionApi.postSessionCreateShareLink({ path: { id } })` → `{ token, expiresAt, id }`
- **Revoke Share:** `SessionApi.deleteSessionRevokeShareLink({ path: { id } })` → `{ ok }`
- **WebSocket:** `connectLiveSession(sessionId, callbacks)` for live session streaming

---

## Layout State (LocalStorage Keys)

- `uxrr:sidebar-layout` → `'right' | 'bottom'` (default: 'right')
- `uxrr:sidebar-size-right` → number (default: 420)
- `uxrr:sidebar-size-bottom` → number (default: 300)

---

## Filter & Query Parameters

### Session List Filters
```typescript
interface SessionListFilters {
    appId?: string;
    userId?: string;
    deviceId?: string;
    from?: string;
    to?: string;
}
```

### Session Query Params
```typescript
interface SessionQueryParams {
    appId?: string;
    userId?: string;
    deviceId?: string;
    from?: string;     // ISO date string
    to?: string;       // ISO date string
    hasChat?: boolean;
    limit?: number;
    offset?: number;
}
```

---

## Important Details for VRT Fixtures

1. **Date/Time Formatting:**
   - Sessions use ISO 8601 strings: `new Date(session.startedAt).toISOString()`
   - Log timestamps are unix ms: `Date.now()`
   - Dates displayed: `date-fns` format (e.g., `format(new Date(...), 'MMM d, yyyy HH:mm:ss')`)

2. **Log Levels** are numeric: 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR

3. **Network Logs** have scope `'uxrr:net'` and extract from `ILogEntry.d` field

4. **Live Status** states: `null`, `'waiting'`, `'syncing'`, `'live'`, `'ended'`

5. **Admin Badge** shows when `authState.me?.isAdmin === true`

6. **Chat Separator** messages have `from === '__separator'`

7. **Color Status Codes:**
   - 200-299: Green (success)
   - 300-399: Yellow (redirect)
   - Other: Red (error)

8. **Grafana Integration:** Links are built by `buildGrafanaTraceUrl(baseUrl, datasource, traceId)`

9. **Interactive Mode:** Live sessions with `hasControl === true` can send cursor, highlight, pen, and chat messages

10. **Event Chunks:** Sessions track `eventChunkCount` for segmented event storage

