# Identity

uxrr automatically assigns a persistent device ID (stored in `localStorage`) and a unique session ID generated on each `init()` call. You can enrich sessions with user identity information.

## Identifying Users

Call `identify()` when you know who the user is — typically after login:

```typescript
import { uxrr } from '@zyno-io/uxrr-client';

uxrr.identify({
    userId: user.id,
    userName: user.name,
    userEmail: user.email
});
```

All fields are optional. Identity is associated with the current session and appears in the dashboard's session list.

## Before Initialization

You can call `identify()` before `init()`. The identity is cached and applied once the SDK initializes:

```typescript
import { uxrr } from '@zyno-io/uxrr-client';

// This works — identity is queued
uxrr.identify({ userId: 'user-123' });

// Later...
init({ endpoint: '...', appId: '...' });
```

## Identity Fields

| Field            | Type     | Description                                                                 |
| ---------------- | -------- | --------------------------------------------------------------------------- |
| `userId`         | `string` | Your application's user ID                                                  |
| `userName`       | `string` | Display name                                                                |
| `userEmail`      | `string` | Email address                                                               |
| `deviceId`       | `string` | Auto-generated, persisted in `localStorage`                                 |
| `deviceIdPrefix` | `string` | Optional prefix prepended to the device ID (useful for multi-tenant setups) |
