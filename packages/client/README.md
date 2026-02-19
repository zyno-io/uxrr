# @zyno-io/uxrr-client

Browser SDK for [uxrr](https://github.com/zyno-io/uxrr) — session recording, structured logging, distributed tracing, and live agent support for web applications.

## Features

- **Session Recording** — Full DOM recording via [rrweb](https://github.com/rrweb-io/rrweb) with configurable privacy controls
- **Structured Logging** — Scoped loggers with automatic trace ID correlation
- **Distributed Tracing** — OpenTelemetry-based `fetch`/`XMLHttpRequest` instrumentation with request/response capture
- **Live Agent Support** — Real-time session streaming with co-browsing, annotations, and chat
- **Automatic Flushing** — Data sent on page unload and visibility change via `sendBeacon`

## Installation

```bash
npm install @zyno-io/uxrr-client
# or
yarn add @zyno-io/uxrr-client
```

## Quick Start

```typescript
import { uxrr } from '@zyno-io/uxrr-client';

// Identify the user (works before init — cached until ready)
uxrr.identify({
    userId: 'user-123',
    userName: 'Jane Doe',
    userEmail: 'jane@example.com'
});

// Initialize the SDK
uxrr.init({
    endpoint: 'https://your-uxrr-server.com',
    appId: 'my-app',
    version: '1.0.0',
    environment: 'production'
});
```

## API

The SDK exports a singleton `uxrr` instance and an OpenTelemetry `tracer`:

```typescript
import { uxrr, tracer } from '@zyno-io/uxrr-client';
```

### `uxrr.init(config)`

Initializes all subsystems. Must be called once. See [Configuration](#configuration) for the full config interface.

### `uxrr.identify(identity)`

Sets user and device identity. Can be called before `init()` — the identity is cached and applied when the SDK starts.

```typescript
uxrr.identify({
    userId: 'user-123', // Your user ID
    userName: 'Jane Doe', // Display name
    userEmail: 'jane@ex.com', // Email
    deviceId: 'device-abc', // Explicit device ID (auto-generated if omitted)
    deviceIdPrefix: 'web-' // Prefix for auto-generated device IDs
});
```

### `uxrr.createLogger(scope, data?)`

Creates a scoped logger. Works before `init()` — logs to console immediately, buffered for the server once initialized.

```typescript
const logger = uxrr.createLogger('checkout', { cartId: 'cart-789' });
logger.info('Payment page loaded');
logger.error('Payment failed', { code: 'DECLINED' });

// Nested scopes
const stripeLogger = logger.createScoped('stripe');
stripeLogger.warn('Token expiring'); // scope: "checkout/stripe"
```

### `uxrr.flush()`

Manually flushes buffered events and logs to the server. Returns a promise.

### `uxrr.stop()`

Tears down all subsystems and stops recording.

### `tracer`

An OpenTelemetry `Tracer` for creating custom spans:

```typescript
import { tracer } from '@zyno-io/uxrr-client';

const span = tracer.startSpan('process-payment');
try {
    await processPayment();
    span.end();
} catch (err) {
    span.recordException(err);
    span.end();
}
```

### `uxrr.sessionId`

The current session ID (a UUID persisted in `sessionStorage`).

## Configuration

```typescript
interface UxrrConfig {
    // Required
    endpoint: string; // uxrr server URL
    appId: string; // Application identifier

    // Optional
    version?: string; // App version
    environment?: string; // e.g. 'production', 'staging'

    // Feature toggles (all default to true)
    enabled?: {
        sessions?: boolean; // DOM recording
        logging?: boolean; // Log capture
        tracing?: boolean; // OpenTelemetry
        support?: boolean; // Live agent support
    };

    // Session recording options
    recording?: {
        privacy?: {
            maskInputs?: boolean; // Mask input values (default: true)
            maskTextContent?: boolean; // Mask all text (default: false)
            blockSelector?: string; // CSS selector to block from recording
            consoleLogLevel?: ('log' | 'info' | 'warn' | 'error' | 'debug' | 'assert')[];
        };
    };

    // Logging options
    logging?: {
        consolePrefix?: string; // Prefix for console output
        flushInterval?: number; // Flush timer in ms (default: 5000)
        maxQueueSize?: number; // Max queued logs (default: 1500)
    };

    // Tracing options
    tracing?: {
        logRequests?: boolean; // Log HTTP requests (default: true)
        propagateToOrigins?: (string | RegExp)[]; // Origins to send trace headers to
        ignoreUrls?: (string | RegExp)[]; // URLs to skip
        spanAttributes?: () => Record<string, string>;

        // Request/response capture: 'never' | 'always' | 'onError'
        includeRequestHeaders?: CaptureMode;
        includeRequestBody?: CaptureMode;
        includeResponseHeaders?: CaptureMode;
        includeResponseBody?: CaptureMode;

        includeAuthorizationInHeader?: boolean; // Include auth header (default: false)
        allowListHeaderNames?: string[]; // Only capture these headers
        denyListHeaderNames?: string[]; // Exclude these headers
    };

    // Live agent support options
    support?: {
        renderUI?: boolean; // Show chat widget (default: true)
        onAgentConnected?: () => void;
        onAgentDisconnected?: () => void;
        onAnnotation?: (type: 'highlight', x: number, y: number) => void;
        onChat?: (message: string, from: string) => void;
    };
}
```

## How It Works

**Events & Logs** are collected in a unified `IngestBuffer` and flushed together to `POST /v1/ng/{appId}/{sessionId}/data`. In normal mode, the buffer flushes every 5 seconds or when 50 events accumulate. During live sessions (agent connected), data is pushed immediately over WebSocket.

**Traces** flow through a separate OpenTelemetry `BatchSpanProcessor` to `POST /v1/ng/{appId}/{sessionId}/t` in OTLP JSON format. Session and identity attributes are automatically injected into every span.

On page unload, the `FlushCoordinator` sends any remaining data via `sendBeacon` for best-effort delivery.

## License

See [LICENSE](https://github.com/zyno-io/uxrr/blob/main/LICENSE.md) in the repository root.
