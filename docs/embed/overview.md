# Embed API

The Embed API lets you embed uxrr session lists and session playback into your own application via iframes, or access session data directly via REST API using API keys.

## Overview

The system has two layers:

1. **API Keys** — long-lived credentials for server-to-server access and token signing
2. **Embed Tokens** — short-lived, HMAC-signed tokens for iframe embedding

API keys can be scoped as `readonly` (view sessions) or `interactive` (view + live interaction tools, chat). They can be bound to one or more apps.

## API Key Management

API key management endpoints require OIDC authentication with admin scope (Bearer token).

### Create an API Key

```bash
curl -X POST /v1/api-keys \
  -H "Authorization: Bearer $OIDC_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production Dashboard",
    "scope": "readonly",
    "appIds": ["my-app"]
  }'
```

Response:

```json
{
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Production Dashboard",
    "keyPrefix": "A1B2C3D4",
    "scope": "readonly",
    "appIds": ["my-app"],
    "isActive": true,
    "createdAt": "2025-01-15T10:00:00.000Z",
    "updatedAt": "2025-01-15T10:00:00.000Z",
    "key": "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8S9T0U1V2"
}
```

**Important:** The `key` field containing the raw API key is only returned on creation. Store it securely.

### List API Keys

```bash
curl /v1/api-keys -H "Authorization: Bearer $OIDC_TOKEN"
```

### Update a Key

```bash
curl -X PATCH /v1/api-keys/{id} \
  -H "Authorization: Bearer $OIDC_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Updated Name", "scope": "interactive" }'
```

All fields are optional. You can update `name`, `scope`, `appIds`, and `isActive`.

### Revoke a Key

```bash
curl -X DELETE /v1/api-keys/{id} -H "Authorization: Bearer $OIDC_TOKEN"
```

Revoked keys stop working for both direct API access and embed token verification. Note: API key lookups are cached for up to 60 seconds, so revocation may take up to a minute to propagate across server instances.

## Key Scopes

| Scope         | REST API Access                   | Embed View              | Live Interaction             | Chat              |
| ------------- | --------------------------------- | ----------------------- | ---------------------------- | ----------------- |
| `readonly`    | Read sessions, events, logs, chat | Session list + playback | No                           | View only         |
| `interactive` | Read sessions, events, logs, chat | Session list + playback | Cursor, highlight, pen tools | Full send/receive |

## Multi-App Binding

A single API key can be bound to multiple apps:

```json
{
    "name": "Org-wide Key",
    "scope": "readonly",
    "appIds": ["app-frontend", "app-backend", "app-mobile"]
}
```

- **Single app key** (`appIds` has 1 entry): embed UI auto-filters to that app, hides the app dropdown
- **Multi-app key** (`appIds` has 2+ entries): embed UI shows a dropdown to select between apps
- **Empty `appIds`** (`[]`): access to all apps (use with caution)

## Direct REST API Access

Use the `X-API-Key` header for direct API access from your backend:

```bash
curl /v1/sessions -H "X-API-Key: A1B2C3D4..."
curl /v1/sessions/{id} -H "X-API-Key: A1B2C3D4..."
curl /v1/sessions/{id}/events -H "X-API-Key: A1B2C3D4..."
curl /v1/sessions/{id}/logs -H "X-API-Key: A1B2C3D4..."
curl /v1/sessions/{id}/chat -H "X-API-Key: A1B2C3D4..."
```

Results are automatically filtered to the apps bound to the API key.

## Signing Embed Tokens

Embed tokens are short-lived HMAC-SHA256 signed tokens used for iframe embedding.

### Token Payload

| Field   | Type       | Required | Description                                     |
| ------- | ---------- | -------- | ----------------------------------------------- |
| `kid`   | `string`   | Auto     | API key ID (added automatically during signing) |
| `exp`   | `number`   | Yes      | Expiry as Unix timestamp (seconds)              |
| `scope` | `string`   | Yes      | `"readonly"` or `"interactive"`                 |
| `apps`  | `string[]` | Yes      | App IDs (must be subset of key's apps)          |
| `sid`   | `string`   | No       | Restrict to a specific session ID               |

### Option A: Server-Side Convenience Endpoint

```bash
curl -X POST /v1/api-keys/sign \
  -H "X-API-Key: A1B2C3D4..." \
  -H "Content-Type: application/json" \
  -d '{
    "exp": 1705320000,
    "scope": "readonly",
    "apps": ["my-app"]
  }'
```

### Option B: Self-Signing (Node.js)

```javascript
import { createHmac } from 'crypto';

function signEmbedToken(apiKeyId, apiKeySecret, { exp, scope, apps, sid }) {
    const payload = { kid: apiKeyId, exp, scope, apps };
    if (sid) payload.sid = sid;

    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', apiKeySecret).update(payloadB64).digest('base64url');

    return `${payloadB64}.${sig}`;
}

const token = signEmbedToken('550e8400-e29b-41d4-a716-446655440000', 'A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8S9T0U1V2', {
    exp: Math.floor(Date.now() / 1000) + 3600,
    scope: 'readonly',
    apps: ['my-app']
});
```

### Option C: Self-Signing (Python)

```python
import json, hmac, hashlib, base64, time

def sign_embed_token(api_key_id, api_key_secret, exp, scope, apps, sid=None):
    payload = {"kid": api_key_id, "exp": exp, "scope": scope, "apps": apps}
    if sid:
        payload["sid"] = sid

    payload_json = json.dumps(payload, separators=(",", ":"))
    payload_b64 = base64.urlsafe_b64encode(payload_json.encode()).rstrip(b"=").decode()
    sig = hmac.new(
        api_key_secret.encode(), payload_b64.encode(), hashlib.sha256
    ).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()

    return f"{payload_b64}.{sig_b64}"

token = sign_embed_token(
    "550e8400-e29b-41d4-a716-446655440000",
    "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8S9T0U1V2",
    exp=int(time.time()) + 3600,
    scope="readonly",
    apps=["my-app"],
)
```

## Embedding in Iframes

### Session List

```html
<iframe src="https://uxrr.yourcompany.com/embed?token=EMBED_TOKEN" width="100%" height="600" frameborder="0"></iframe>
```

- Single-app token: app filter is hidden, sessions auto-filtered
- Multi-app token: a dropdown appears to switch between apps
- Sessions update in real-time via WebSocket
- Clicking a session navigates to detail within the iframe

### Specific Session Playback

```html
<iframe
    src="https://uxrr.yourcompany.com/embed/SESSION_ID?token=EMBED_TOKEN"
    width="100%"
    height="600"
    frameborder="0"
></iframe>
```

### Session-Specific Tokens

Sign a token with `sid` to lock it to one session:

```javascript
const token = signEmbedToken(keyId, keySecret, {
    exp: Math.floor(Date.now() / 1000) + 3600,
    scope: 'readonly',
    apps: ['my-app'],
    sid: 'target-session-id'
});
```

When `sid` is set, the back button is hidden and the token only grants access to that session.

## Scope Behavior in Embed Views

### Readonly

- Session list and playback work normally
- No interaction toolbar
- Chat is view-only
- WebSocket connected as shared viewer

### Interactive

- Full interaction toolbar during live sessions (cursor, highlight, pen)
- Chat with send capability
- "Take Control" button when another agent has control
- WebSocket connected as embed user agent

## Token Validation

The server validates embed tokens in this order:

1. Parse `base64url(payload).base64url(signature)` format
2. Check expiry (`exp` field)
3. Look up API key by `kid` (cached for 60s)
4. Verify HMAC-SHA256 signature (constant-time comparison)
5. Validate token scope does not exceed key scope

## Error Handling

| Scenario                        | HTTP Status | Error                         |
| ------------------------------- | ----------- | ----------------------------- |
| Missing auth header             | 401         | Unauthorized                  |
| Invalid API key                 | 401         | Authentication required       |
| Invalid embed token format      | 401         | Authentication required       |
| Expired embed token             | 401         | Authentication required       |
| Token scope exceeds key scope   | 403         | Token scope exceeds key scope |
| Revoked API key                 | 401         | Authentication required       |
| App not in key's allowed apps   | 403         | App not allowed for this key  |
| Session not in token's sessions | 403         | Access denied                 |

## Security Notes

- API key secrets are encrypted at rest (AES-256-GCM); the raw key is used for embed token HMAC
- Only the `keyPrefix` (first 8 characters) is shown in responses
- The raw key is only returned once, on creation
- Embed tokens verified with `timingSafeEqual` to prevent timing attacks
- Token expiry checked before database lookups
- Revoking a key invalidates all tokens signed with it (within cache TTL of 60s)
