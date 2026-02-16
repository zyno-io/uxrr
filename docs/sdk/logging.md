# Logging

uxrr captures console output automatically and provides a scoped logger API for structured logging.

## Automatic Console Capture

By default, `console.warn`, `console.error`, and `console.assert` calls are captured and sent to the server. They appear in the Console panel during session replay. To capture additional levels (like `console.log` or `console.debug`), see [Privacy Controls](./privacy).

## Scoped Loggers

Create named loggers for structured, filterable log output:

```typescript
import { uxrr } from '@zyno-io/uxrr-client';

const logger = uxrr.createLogger('checkout');

logger.info('Cart updated', { itemCount: 3 });
logger.warn('Slow network detected');
logger.error('Payment failed', { code: 'CARD_DECLINED' });
logger.debug('Retry attempt', { attempt: 2 });
```

Scoped loggers created before `init()` will output to the console only. To send logs to the server, create loggers after calling `init()`.

### Attached Data

You can attach data to a logger when creating it. The data is automatically included in every log entry from that logger:

```typescript
const logger = uxrr.createLogger('checkout', { cartId: 'abc-123' });

// Both entries include { cartId: 'abc-123' } automatically
logger.info('Cart updated', { itemCount: 3 }); // merged: { cartId: 'abc-123', itemCount: 3 }
logger.warn('Slow network detected'); // data: { cartId: 'abc-123' }
```

### Nested Scopes

Create child loggers with `createScoped`. The scope name is appended to the parent's, and you can attach additional data that merges with the parent's data:

```typescript
const paymentLogger = logger.createScoped('payment', { provider: 'stripe' });
// Scope: "checkout/payment"
// Every log includes { cartId: 'abc-123', provider: 'stripe' }
paymentLogger.info('Processing...');
```

## Configuration

```typescript
init({
    // ...
    logging: {
        consolePrefix: 'myapp', // Prefix for console output
        flushInterval: 5000, // Flush interval in ms (default: 5000)
        maxQueueSize: 1500 // Max queued logs before oldest are dropped (default: 1500)
    }
});
```

## Log Levels

| Method           | Level |
| ---------------- | ----- |
| `logger.debug()` | debug |
| `logger.info()`  | info  |
| `logger.warn()`  | warn  |
| `logger.error()` | error |
