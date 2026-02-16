# Installation

## Package Manager

```bash
npm install @zyno-io/uxrr-client
# or
yarn add @zyno-io/uxrr-client
# or
pnpm add @zyno-io/uxrr-client
```

## Initialize

Call `init()` as early as possible in your application — ideally before your framework mounts:

```typescript
import { init } from '@zyno-io/uxrr-client';

init({
    endpoint: 'https://uxrr.internal.yourcompany.com',
    appId: 'my-app'
});
```

Sessions are now being recorded and sent to your uxrr server.

::: tip Server prerequisite
Your uxrr server must have an **app** registered with a matching `appId` and an allowed origin for your domain. See the [Deployment guide](/self-hosting/deployment) for details.
:::

## What Gets Recorded

By default, `init()` enables:

- **Session recording** — DOM mutations, scroll, mouse movement, input interactions (inputs and text content are masked by default)
- **Console logging** — `console.warn`, `console.error`, and `console.assert`
- **Network tracing** — HTTP requests via `fetch` (logged in the Network panel) and `XMLHttpRequest` (trace spans only). Headers and bodies are not captured by default.

Each of these can be individually disabled or configured. See [Configuration](./configuration) for details.

## Exports

The `@zyno-io/uxrr-client` package exports:

| Export         | Description                                                                     |
| -------------- | ------------------------------------------------------------------------------- |
| `init(config)` | Initialize uxrr with your configuration                                         |
| `uxrr`         | Singleton instance — access `identify()`, `createLogger()`, `flush()`, `stop()` |
| `tracer`       | OpenTelemetry `Tracer` for custom spans                                         |

```typescript
import { init, uxrr, tracer } from '@zyno-io/uxrr-client';
```
