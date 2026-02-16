# Architecture

uxrr is a Yarn monorepo with three packages that work together to capture, store, and replay user sessions.

## Components

```
┌─────────────────┐       ┌─────────────────────────────────────────┐
│   Your Web App  │       │             uxrr Server                 │
│                 │       │                                         │
│  ┌───────────┐  │  HTTP │  ┌───────────┐    ┌──────────────────┐ │
│  │ @zyno-io/uxrr-    │──┼───────┼─▶│  Ingest   │───▶│    PostgreSQL    │ │
│  │ client    │  │       │  │  Service   │    │  (session meta)  │ │
│  └───────────┘  │       │  │           │    ├──────────────────┤ │
│                 │       │  │           │───▶│   S3-compatible  │ │
└─────────────────┘       │  │           │    │   (event chunks) │ │
                          │  │           │    ├──────────────────┤ │
                          │  │           │───▶│      Loki        │ │
                          │  │           │    │   (logs)         │ │
                          │  │           │    ├──────────────────┤ │
                          │  │           │───▶│     Tempo        │ │
                          │  └───────────┘    │   (traces)       │ │
                          │                   └──────────────────┘ │
                          │  ┌───────────┐                         │
┌─────────────────┐       │  │ WebSocket │◀── live session relay   │
│   @zyno-io/uxrr-ui      │◀──────┼──│  Service  │                        │
│   (dashboard)   │       │  └───────────┘                        │
└─────────────────┘       │                   ┌──────────────────┐ │
                          │                   │  Redis (optional)│ │
                          │                   │  (scaling)       │ │
                          └───────────────────┴──────────────────┘
```

## Data Flow

### Events and Logs

The browser SDK buffers events and logs together and sends them in a single `POST /v1/ng/{appId}/{sessionId}/data` request. The server splits this payload:

- **Events** → stored as chunks in S3-compatible storage
- **Logs** → forwarded to Loki with labels for app, device, and user (session ID is included in the log line JSON, not as a Loki label)

In normal mode, the SDK flushes every 5 seconds (or at 50 events). On page unload, it uses `sendBeacon` for a final flush.

### Traces

Network traces flow through a separate OpenTelemetry pipeline. The SDK's `BatchSpanProcessor` sends JSON-encoded spans to the server's OTLP endpoint, which forwards them to Tempo.

### Live Sessions

When an agent connects to an active session via the dashboard, the server upgrades both connections to WebSocket. Events and logs are relayed directly between the client SDK and the agent's browser for real-time delivery, while also being persisted through the normal storage pipeline.

## Storage Backends

| Backend               | Stores                                   | Notes                                                                     |
| --------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| PostgreSQL            | Session metadata, apps, API keys         | Required                                                                  |
| S3-compatible storage | Recorded events (chunked)                | Required — any S3-compatible store works                                  |
| Loki                  | Console logs and network request logs    | Optional — without it, the console and network panels in replay are empty |
| Tempo                 | Distributed traces (OpenTelemetry spans) | Optional — stores traces for distributed tracing                          |
| Grafana               | Trace visualization                      | Optional — enables "View in Grafana" links in the network panel           |
| Redis                 | Pub/sub for multi-instance               | Optional — only needed if running multiple server instances               |

## Scalability

uxrr is designed to scale with your infrastructure by building on proven, horizontally scalable storage backends:

- **S3-compatible storage** — Event data is stored as chunks in any S3-compatible object store (AWS S3, MinIO, LocalStack, etc.), which scales independently of the uxrr server.
- **LGTM stack** — Logs and traces are stored in Grafana's LGTM stack (Loki for logs, Tempo for traces, Grafana for visualization). These are battle-tested, horizontally scalable systems designed for high-volume observability data.
- **OpenTelemetry** — Network traces are captured via OpenTelemetry and forwarded to Tempo using the standard OTLP protocol. This means uxrr's trace pipeline is compatible with any OpenTelemetry-compatible backend.
- **Redis pub/sub** — For multi-instance deployments, Redis coordinates live session relay and real-time updates across server instances.
