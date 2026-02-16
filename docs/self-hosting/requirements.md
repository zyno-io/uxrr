# Requirements

## Infrastructure

uxrr requires the following services:

### Required

| Service                   | Version | Purpose                                                                |
| ------------------------- | ------- | ---------------------------------------------------------------------- |
| **PostgreSQL**            | 15+     | Session metadata, app configuration, API keys                          |
| **S3-compatible storage** | —       | Event chunk storage (AWS S3, MinIO, LocalStack, etc.)                  |
| **OIDC provider**         | —       | Authentication for the dashboard (Keycloak, Auth0, Okta, Google, etc.) |
| **Node.js**               | 22+     | Runtime for the server                                                 |

### Optional

| Service     | Purpose                        | What happens without it                                                                                        |
| ----------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Loki**    | Log storage and search         | Console and network panels in replay are empty — logs are only stored in Loki                                  |
| **Tempo**   | Distributed trace storage      | Trace linking and "View in Grafana" links are unavailable — the network panel itself is driven by logs in Loki |
| **Redis**   | Pub/sub for horizontal scaling | Server is limited to a single instance                                                                         |
| **Grafana** | Trace visualization links      | "View in Grafana" links in the network panel are hidden                                                        |

## Deployment Options

uxrr is a single Node.js process that serves both the API and the static UI assets. You can deploy it as:

- A **container** (official image: `ghcr.io/zyno-io/uxrr`)
- A **Node.js process** behind a reverse proxy (nginx, Caddy, etc.)
- On **Kubernetes** via a Deployment

The server listens on port **8977** by default.

## Network

The server needs outbound access to:

- PostgreSQL (port 5432)
- S3 endpoint (varies)
- OIDC issuer (HTTPS, for JWKS fetching)
- Loki push API (port 3100, if configured)
- Tempo OTLP endpoint (port 4318, if configured)
- Redis (port 6379, if configured)

Client browsers need access to:

- The uxrr server endpoint (for data ingestion and WebSocket connections)
