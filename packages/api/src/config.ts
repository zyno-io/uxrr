import { BaseAppConfig } from '@zyno-io/dk-server-foundation';
import { MinLength } from '@deepkit/type';

export class UxrrConfig extends BaseAppConfig {
    // S3
    S3_ENDPOINT?: string;
    S3_REGION: string = 'us-east-1';
    S3_BUCKET: string = 'uxrr-events';
    S3_ACCESS_KEY_SECRET?: string;
    S3_SECRET_KEY_SECRET?: string;
    S3_FORCE_PATH_STYLE: boolean = true;

    // OTLP forwarding
    OTLP_TRACES_URL?: string;

    // Loki
    LOKI_URL?: string;
    LOKI_AUTH_USER?: string;
    LOKI_AUTH_PASSWORD_SECRET?: string;

    // OIDC
    OIDC_ISSUER_URL?: string;
    OIDC_CLIENT_ID?: string;
    OIDC_AUDIENCE?: string;
    OIDC_ISSUER?: string;
    OIDC_SCOPES: string = 'openid profile email';

    // OIDC role-based access (optional — when set, only matching tokens get admin scope)
    OIDC_ADMIN_CLAIM?: string;
    OIDC_ADMIN_VALUE?: string;

    // Grafana
    GRAFANA_URL?: string;
    GRAFANA_DATASOURCE: string = 'tempo';

    // Share links
    UXRR_SHARE_SECRET?: string & MinLength<32>;

    // UXRR-specific
    UXRR_DEV_MODE: boolean = false;
    UXRR_MAX_EVENT_BATCH_SIZE: number = 500;
    UXRR_MAX_LOG_BATCH_SIZE: number = 200;
    UXRR_INGEST_EVENT_FLUSH_DELAY_MS: number = 30000;
    UXRR_INGEST_EVENT_FLUSH_MAX_EVENTS: number = 200;
    UXRR_INGEST_EVENT_FLUSH_MAX_BYTES: number = 262144;
    UXRR_MAX_EMBED_TOKEN_TTL: number = 2592000; // 30 days in seconds

    // Data retention (0 = disabled, keep forever)
    DATA_RETENTION_DAYS: number = 30;
}
