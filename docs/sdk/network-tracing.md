# Network Tracing

uxrr instruments `fetch` and `XMLHttpRequest` via OpenTelemetry for distributed tracing. Additionally, `fetch` requests are logged as structured entries that appear in the Network panel during session replay. (`XMLHttpRequest` requests generate trace spans but do not appear in the Network panel.)

::: tip Server requirement
The Network panel is powered by logs stored in Loki. If your server does not have `LOKI_URL` configured, the network panel in replay will be empty.
:::

## What's Captured

For each HTTP request:

- URL, method, status code
- Request and response headers (configurable)
- Request and response bodies (configurable)
- Timing information
- Trace context for distributed tracing

## Configuration

```typescript
init({
    // ...
    tracing: {
        // Log fetch requests as log entries for the Network panel (default: true)
        // Set to false to disable the Network panel while keeping trace spans active
        logRequests: true,

        // Propagate trace context to these origins (for distributed tracing)
        propagateToOrigins: ['https://api.yourcompany.com', /^https:\/\/.*\.yourcompany\.com/],

        // Don't instrument requests to these URLs
        ignoreUrls: [/\/health$/, 'https://analytics.example.com'],

        // Header/body capture modes: 'always', 'onError', or 'never' (default: 'never')
        includeRequestHeaders: 'always',
        includeRequestBody: 'onError',
        includeResponseHeaders: 'always',
        includeResponseBody: 'onError',

        // Strip Authorization header by default (set true to include)
        includeAuthorizationInHeader: false,

        // Fine-grained header filtering
        allowListHeaderNames: ['content-type', 'x-request-id'],
        denyListHeaderNames: ['cookie', 'set-cookie'],

        // Add custom attributes to every span
        spanAttributes: () => ({
            'app.tenant': getCurrentTenant()
        })
    }
});
```

## Capture Modes

The `includeRequest*` and `includeResponse*` options accept these values:

| Mode        | Behavior                                                             |
| ----------- | -------------------------------------------------------------------- |
| `'always'`  | Always capture                                                       |
| `'onError'` | Capture only when the request fails (status >= 400 or network error) |
| `'never'`   | Never capture (default)                                              |

## Custom Spans

The `tracer` export gives you a standard OpenTelemetry `Tracer` for custom instrumentation:

```typescript
import { tracer } from '@zyno-io/uxrr-client';

const span = tracer.startSpan('checkout.process');
try {
    await processCheckout();
    span.setStatus({ code: 1 }); // OK
} catch (err) {
    span.setStatus({ code: 2, message: err.message }); // ERROR
    throw err;
} finally {
    span.end();
}
```
