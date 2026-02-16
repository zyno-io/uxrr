# Deployment

## Building from Source

```bash
# Clone the repository
git clone https://github.com/zyno-io/uxrr.git
cd uxrr

# Install dependencies
yarn install

# Build all packages
yarn build
```

The built server is at `packages/api/dist/` and the UI static assets are at `packages/api/static/`.

## Running the Server

```bash
# Run database migrations
cd packages/api
node . migration:run

# Start the server
node . server:start
```

The server starts on port 8977.

## Environment Variables

At minimum, you need to configure PostgreSQL, S3, and OIDC. See [Configuration Reference](./configuration) for the full list.

```bash
# PostgreSQL
PG_HOST=localhost
PG_PORT=5432
PG_USER=uxrr
PG_PASSWORD_SECRET=your-password
PG_DATABASE=uxrr

# S3
S3_ENDPOINT=https://s3.amazonaws.com
S3_REGION=us-east-1
S3_BUCKET=uxrr-events
S3_ACCESS_KEY_SECRET=AKIA...
S3_SECRET_KEY_SECRET=...

# Encryption (required — used for API key secret storage)
CRYPTO_SECRET=your-32-byte-secret-key-here.....

# OIDC
OIDC_ISSUER_URL=https://auth.yourcompany.com/realms/main
OIDC_CLIENT_ID=uxrr
```

## Running with Docker Compose

Here's an example `docker-compose.yml` for a minimal local deployment:

```yaml
services:
    uxrr:
        image: ghcr.io/zyno-io/uxrr
        ports:
            - '8977:8977'
        environment:
            PG_HOST: postgres
            PG_DATABASE: uxrr
            PG_USER: uxrr
            PG_PASSWORD_SECRET: changeme
            S3_ENDPOINT: http://localstack:4566
            S3_ACCESS_KEY_SECRET: test
            S3_SECRET_KEY_SECRET: test
            S3_BUCKET: uxrr-events
            CRYPTO_SECRET: change-me-to-a-32-byte-secret!!
            OIDC_ISSUER_URL: https://auth.yourcompany.com/realms/main
            OIDC_CLIENT_ID: uxrr
        depends_on:
            postgres:
                condition: service_healthy
            localstack:
                condition: service_healthy

    postgres:
        image: postgres:17
        environment:
            POSTGRES_DB: uxrr
            POSTGRES_USER: uxrr
            POSTGRES_PASSWORD: changeme
        volumes:
            - pgdata:/var/lib/postgresql/data
        healthcheck:
            test: ['CMD-SHELL', 'pg_isready -U uxrr']
            interval: 2s
            timeout: 5s
            retries: 10

    localstack:
        image: localstack/localstack:latest
        healthcheck:
            test: ['CMD-SHELL', 'curl -sf http://localhost:4566/_localstack/health || exit 1']
            interval: 2s
            timeout: 5s
            retries: 10

volumes:
    pgdata:
```

## Registering Apps

uxrr requires at least one app to be registered before the SDK can send data. Use the admin UI to create and manage apps.

1. Log in to the uxrr dashboard as an admin
2. Navigate to **Admin > Apps**
3. Click **Create App** and fill in:
    - **App ID** — matches the `appId` you pass to `init()` in the SDK
    - **Name** — a display name for the app
    - **Allowed Origins** — the SDK will only be accepted from these origins (checked via the `Origin` header)
4. Optionally, set an **Ingest API Key** for server-to-server ingest (e.g., from a backend). The server stores the SHA-256 hash of the key. When making ingest requests, send the raw key.

The ingest API key is separate from the embed API keys managed under **Admin > API Keys** (see [Embed API](../embed/overview)).

## Dev Mode

For development or evaluation without an OIDC provider:

```bash
UXRR_DEV_MODE=true
```

Dev mode disables authentication. **Do not use in production.**

## Migrations

Database migrations must be run before starting the server:

```bash
cd packages/api
node . migration:run
```

## Reverse Proxy

If you're fronting uxrr with a reverse proxy, make sure to:

1. **Proxy WebSocket connections** — uxrr uses WebSockets for live sessions and real-time session list updates
2. **Increase timeouts** — live sessions can be long-lived
3. **Preserve headers** — pass `X-Forwarded-For` and `X-Forwarded-Proto`

Example nginx config:

```nginx
location / {
    proxy_pass http://localhost:8977;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
}
```

### Rate Limiting with ingress-nginx

If you're running uxrr behind [ingress-nginx](https://kubernetes.github.io/ingress-nginx/) in Kubernetes, you can add rate limiting via annotations on your Ingress resource. This is recommended for production deployments to protect the ingest endpoints from abuse.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
    name: uxrr
    annotations:
        nginx.ingress.kubernetes.io/proxy-read-timeout: '3600'
        nginx.ingress.kubernetes.io/proxy-send-timeout: '3600'
        nginx.ingress.kubernetes.io/proxy-body-size: '10m'

        # WebSocket support
        nginx.ingress.kubernetes.io/upstream-hash-by: '$remote_addr'
        nginx.ingress.kubernetes.io/proxy-http-version: '1.1'

        # Rate limiting
        nginx.ingress.kubernetes.io/limit-rps: '20'
        nginx.ingress.kubernetes.io/limit-burst-multiplier: '5'
        nginx.ingress.kubernetes.io/limit-connections: '10'
spec:
    ingressClassName: nginx
    rules:
        - host: uxrr.yourcompany.com
          http:
              paths:
                  - path: /
                    pathType: Prefix
                    backend:
                        service:
                            name: uxrr
                            port:
                                number: 8977
```

Key annotations:

| Annotation               | Description                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `limit-rps`              | Max requests per second per client IP                                                 |
| `limit-burst-multiplier` | Multiplied by `limit-rps` to set the burst bucket size (e.g., 20 rps x 5 = 100 burst) |
| `limit-connections`      | Max concurrent connections per client IP                                              |
| `proxy-read-timeout`     | Set high (3600s) to support long-lived WebSocket connections for live sessions        |
| `proxy-body-size`        | Max request body size — increase if clients send large event batches                  |

Tune `limit-rps` based on your expected traffic. The SDK sends ingest data every 5 seconds per active session, so a reasonable starting point is 20 rps with a burst multiplier of 5. If you see 503 errors in the SDK, increase the limits.
