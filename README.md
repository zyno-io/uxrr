# uxrr

Self-hosted session recording and replay platform. Capture sessions, logs, network traces, and interact with users in real time — all on your own infrastructure. (SaaS version is coming soon.)

## What It Does

uxrr records everything that happens in your web application and lets your team replay it later:

- **Session Recording** — pixel-perfect replay powered by [rrweb](https://github.com/rrweb-io/rrweb)
- **Console Logs** — captured and searchable alongside session playback
- **Network Traces** — full HTTP request/response visibility via OpenTelemetry
- **Live Sessions** — watch active users in real time, with cursor sharing, annotations, and chat
- **Embeddable** — embed session lists and replay in your own dashboards via iframe or REST API

## Architecture

uxrr is a Yarn monorepo with three packages:

| Package        | Description                                               |
| -------------- | --------------------------------------------------------- |
| `@zyno-io/uxrr-client` | Browser SDK — drop into your web app to start recording   |
| `@zyno-io/uxrr-api`    | Backend — ingests data, stores sessions, serves the API   |
| `@zyno-io/uxrr-ui`     | Admin dashboard — session list, replay player, live tools |

**Infrastructure dependencies:**

| Service        | Purpose                      | Required          |
| -------------- | ---------------------------- | ----------------- |
| PostgreSQL     | Session metadata             | Yes               |
| S3-compatible  | Event storage                | Yes               |
| Loki           | Log storage and search       | Optional          |
| Tempo          | Distributed trace storage    | Optional          |
| Redis          | Horizontal scaling (pub/sub) | Optional          |
| OIDC Provider  | Authentication               | Yes (or dev mode) |

## Quick Start

### 1. Install the SDK

```bash
npm install @zyno-io/uxrr-client
```

### 2. Initialize in your app

```typescript
import { init } from '@zyno-io/uxrr-client';

init({
    endpoint: 'https://uxrr.internal.yourcompany.com',
    appId: 'my-app',
    version: '1.0.0'
});
```

### 3. Identify users (optional)

```typescript
import { uxrr } from '@zyno-io/uxrr-client';

uxrr.identify({
    userId: user.id,
    userName: user.name,
    userEmail: user.email
});
```

### 4. Custom logging

```typescript
const logger = uxrr.createLogger('checkout');
logger.info('Payment processed', { orderId: '12345' });
logger.error('Payment failed', { error: err.message });
```

## Self-Hosting

See the [deployment guide](https://uxrr.dev/self-hosting/deployment) for full instructions.

**Minimum setup** requires PostgreSQL, an S3-compatible store, and an OIDC provider. Configuration is via environment variables:

```bash
# Required
PG_HOST=localhost
PG_DATABASE=uxrr
S3_ENDPOINT=http://localhost:4566
S3_ACCESS_KEY_SECRET=...
S3_SECRET_KEY_SECRET=...
OIDC_ISSUER_URL=https://auth.yourcompany.com
OIDC_CLIENT_ID=uxrr

# Optional
LOKI_URL=http://localhost:3100
OTLP_TRACES_URL=http://localhost:4318/v1/traces
REDIS_HOST=localhost
DATA_RETENTION_DAYS=30
```

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, running tests, and code style guidelines.

## Documentation

Full documentation is available at [uxrr.dev](https://uxrr.dev).

## License

uxrr is **source-available** under the [uxrr Source Available License](LICENSE.md).

**Free for internal use** — you can self-host uxrr within your organization without restriction. A commercial license is required to offer uxrr as a hosted service, embed it in a product sold to others, or distribute it. See [LICENSE.md](LICENSE.md) for details, or contact support@sgnl24.com for commercial licensing.
