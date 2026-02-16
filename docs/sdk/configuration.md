# Configuration

The full configuration interface for `init()`:

```typescript
init({
    // Required
    endpoint: 'https://uxrr.internal.yourcompany.com',
    appId: 'my-app',

    // Optional metadata
    version: '2.1.0',
    environment: 'production',

    // Feature toggles (all default to true)
    enabled: {
        sessions: true,
        logging: true,
        tracing: true,
        support: true
    },

    // Recording options
    recording: {
        /* see Privacy Controls */
    },

    // Logging options
    logging: {
        /* see Logging */
    },

    // Tracing options
    tracing: {
        /* see Network Tracing */
    },

    // Live support options
    support: {
        /* see Live Support */
    }
});
```

## Required Options

| Option     | Type     | Description                                                    |
| ---------- | -------- | -------------------------------------------------------------- |
| `endpoint` | `string` | Base URL of your uxrr server                                   |
| `appId`    | `string` | Application identifier (matches apps configured in the server) |

## Optional Options

| Option        | Type     | Default | Description                                      |
| ------------- | -------- | ------- | ------------------------------------------------ |
| `version`     | `string` | —       | Your app version, shown in the dashboard         |
| `environment` | `string` | —       | Environment name (e.g., `production`, `staging`) |

## Feature Toggles

The `enabled` object lets you disable individual subsystems:

```typescript
init({
    endpoint: '...',
    appId: '...',
    enabled: {
        sessions: true, // DOM recording
        logging: true, // Console capture
        tracing: true, // Network instrumentation
        support: false // Live support WebSocket (requires sessions to be enabled)
    }
});
```

All features default to `true` when not specified.
