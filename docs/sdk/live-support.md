# Live Support

uxrr's live support feature lets your team connect to active user sessions in real time. An agent (your team member) can watch the user's screen, share their cursor, draw annotations, and chat — all without requiring the user to install anything or share their screen.

## How It Works

1. The SDK sends data to the server over HTTP as usual.
2. When an agent connects to a session through the dashboard, the server signals the SDK to upgrade to a WebSocket connection.
3. Once upgraded, events and logs are relayed bidirectionally in real time — the agent sees a live replay and the user sees the agent's cursor and annotations.

## Configuration

```typescript
init({
    // ...
    support: {
        // Render the built-in support UI (cursor, highlights) — default: true
        renderUI: true,

        // Callbacks for custom integration
        onAgentConnected: () => {
            showNotification('A support agent has connected');
        },
        onAgentDisconnected: () => {
            showNotification('The support agent has disconnected');
        },
        onAnnotation: (type, x, y) => {
            // Agent highlighted a point on the screen
        },
        onChat: (message, from) => {
            // Chat message received
        }
    }
});
```

## Disabling

```typescript
init({
    // ...
    enabled: {
        support: false
    }
});
```

When disabled, no WebSocket connection is established for live support.
