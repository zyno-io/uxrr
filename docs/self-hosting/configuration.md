# Configuration Reference

All server configuration is via environment variables.

## PostgreSQL

| Variable             | Default | Description         |
| -------------------- | ------- | ------------------- |
| `PG_HOST`            | —       | PostgreSQL hostname |
| `PG_PORT`            | `5432`  | PostgreSQL port     |
| `PG_USER`            | —       | Database user       |
| `PG_PASSWORD_SECRET` | —       | Database password   |
| `PG_DATABASE`        | —       | Database name       |

## S3 / Object Storage

| Variable               | Default       | Description                                               |
| ---------------------- | ------------- | --------------------------------------------------------- |
| `S3_ENDPOINT`          | —             | S3-compatible endpoint URL                                |
| `S3_REGION`            | `us-east-1`   | S3 region                                                 |
| `S3_BUCKET`            | `uxrr-events` | Bucket name for event storage                             |
| `S3_ACCESS_KEY_SECRET` | —             | Access key                                                |
| `S3_SECRET_KEY_SECRET` | —             | Secret key                                                |
| `S3_FORCE_PATH_STYLE`  | `true`        | Use path-style addressing (required for MinIO, LocalStack) |

## OIDC Authentication

| Variable           | Default                | Description                                                                      |
| ------------------ | ---------------------- | -------------------------------------------------------------------------------- |
| `OIDC_ISSUER_URL`  | —                      | OIDC issuer URL (used for JWKS discovery)                                        |
| `OIDC_CLIENT_ID`   | —                      | OIDC client ID (used by the dashboard for login)                                 |
| `OIDC_AUDIENCE`    | `OIDC_CLIENT_ID`       | Expected `aud` claim in tokens (defaults to `OIDC_CLIENT_ID`)                    |
| `OIDC_ISSUER`      | —                      | Expected `iss` claim override (optional, defaults to `OIDC_ISSUER_URL`)          |
| `OIDC_SCOPES`      | `openid profile email` | Scopes to request during login                                                   |
| `OIDC_ADMIN_CLAIM` | —                      | JWT claim to check for admin role (without this, only the first user gets admin) |
| `OIDC_ADMIN_VALUE` | —                      | Required value in the admin claim                                                |

See [Authentication](./authentication) for setup instructions.

## Loki (Logs)

| Variable                    | Default | Description                                  |
| --------------------------- | ------- | -------------------------------------------- |
| `LOKI_URL`                  | —       | Loki push API URL (e.g., `http://loki:3100`) |
| `LOKI_AUTH_USER`            | —       | Basic auth username (optional)               |
| `LOKI_AUTH_PASSWORD_SECRET` | —       | Basic auth password (optional)               |

## Tempo (Traces)

| Variable          | Default | Description                                              |
| ----------------- | ------- | -------------------------------------------------------- |
| `OTLP_TRACES_URL` | —       | OTLP HTTP endpoint (e.g., `http://tempo:4318/v1/traces`) |

## Grafana

| Variable             | Default | Description                                        |
| -------------------- | ------- | -------------------------------------------------- |
| `GRAFANA_URL`        | —       | Grafana base URL (enables "View in Grafana" links) |
| `GRAFANA_DATASOURCE` | `tempo` | Tempo datasource name in Grafana                   |

## Redis

| Variable               | Default | Description                                       |
| ---------------------- | ------- | ------------------------------------------------- |
| `REDIS_HOST`           | —       | Redis host (enables horizontal scaling)           |
| `REDIS_PORT`           | `6379`  | Redis port                                        |
| `REDIS_SENTINEL_HOST`  | —       | Redis Sentinel host (alternative to `REDIS_HOST`) |
| `REDIS_SENTINEL_PORT`  | —       | Redis Sentinel port                               |
| `REDIS_SENTINEL_NAME`  | —       | Redis Sentinel master name                        |

## Encryption

| Variable        | Default | Description                                                                 |
| --------------- | ------- | --------------------------------------------------------------------------- |
| `CRYPTO_SECRET` | —       | 32-byte key (or 64 hex chars) for AES-256-GCM encryption of API key secrets |

## Application Settings

| Variable                    | Default   | Description                                                      |
| --------------------------- | --------- | ---------------------------------------------------------------- |
| `UXRR_DEV_MODE`             | `false`   | Bypass OIDC authentication (development only)                    |
| `UXRR_MAX_EVENT_BATCH_SIZE` | `500`     | Max events per ingest request                                    |
| `UXRR_MAX_LOG_BATCH_SIZE`   | `200`     | Max logs per ingest request                                      |
| `UXRR_INGEST_EVENT_FLUSH_DELAY_MS` | `30000` | Max time to buffer ingest events before writing an S3 chunk |
| `UXRR_INGEST_EVENT_FLUSH_MAX_EVENTS` | `200` | Flush ingest event buffer when this many events are queued |
| `UXRR_INGEST_EVENT_FLUSH_MAX_BYTES` | `262144` | Flush ingest event buffer when buffered JSON size reaches this many bytes |
| `UXRR_MAX_EMBED_TOKEN_TTL`  | `2592000` | Max embed token lifetime in seconds (30 days)                    |
| `UXRR_SHARE_SECRET`         | —         | Secret for generating share links (min 32 characters)            |
| `DATA_RETENTION_DAYS`       | `30`      | Auto-delete sessions older than this (0 = keep forever)          |
