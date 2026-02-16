# Privacy Controls

uxrr masks form inputs by default and does not capture network headers/bodies unless you opt in. Text content is visible in recordings by default but can be masked if needed.

## Input Masking (default: on)

Input values (text fields, textareas, selects) are masked by default. To disable:

```typescript
init({
    // ...
    recording: {
        privacy: {
            maskInputs: false
        }
    }
});
```

When enabled, input values are replaced with `*` characters in the recording.

## Text Content Masking (default: off)

All visible text content on the page can be masked by opting in:

```typescript
init({
    // ...
    recording: {
        privacy: {
            maskTextContent: true
        }
    }
});
```

When enabled, all text in the recorded page is replaced with `*` characters. This applies to all elements, not just inputs — headings, paragraphs, buttons, etc.

## Block Specific Elements

Exclude specific DOM elements from recording entirely using a CSS selector:

```typescript
init({
    // ...
    recording: {
        privacy: {
            blockSelector: '.sensitive-data, [data-uxrr-block]'
        }
    }
});
```

Blocked elements are replaced with a placeholder in the recording.

## Console Log Level Filtering

Control which console log levels are captured:

```typescript
init({
    // ...
    recording: {
        privacy: {
            consoleLogLevel: ['log', 'info', 'warn', 'error', 'debug', 'assert']
            // Capture all levels (default is only ['warn', 'error', 'assert'])
        }
    }
});
```

## Network Privacy

See [Network Tracing](./network-tracing) for options to control header and body capture, strip authorization headers, and filter specific URLs.

## Disabling Features Entirely

```typescript
init({
    // ...
    enabled: {
        sessions: false, // No DOM recording at all
        logging: false, // No console capture
        tracing: false // No network instrumentation
    }
});
```
