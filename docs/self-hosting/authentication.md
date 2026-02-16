# Authentication (OIDC)

uxrr uses OpenID Connect for dashboard authentication. Any standards-compliant OIDC provider works — Keycloak, Auth0, Okta, Google, Azure AD, etc.

## Setup

### 1. Create an OIDC client

In your identity provider, create a new client (application) for uxrr:

- **Client type**: Public (SPA)
- **Grant type**: Authorization Code with PKCE
- **Redirect URI**: `https://uxrr.yourcompany.com/auth/callback`
- **Silent redirect URI**: `https://uxrr.yourcompany.com/auth/silent-callback` (for token renewal)
- **Post-logout redirect URI**: `https://uxrr.yourcompany.com/`
- **Scopes**: `openid`, `profile`, `email`

### 2. Configure the server

```bash
OIDC_ISSUER_URL=https://auth.yourcompany.com/realms/main
OIDC_CLIENT_ID=uxrr
```

The server fetches the JWKS from `{OIDC_ISSUER_URL}/.well-known/openid-configuration` to validate tokens.

### 3. Optional: audience validation

`OIDC_AUDIENCE` defaults to the value of `OIDC_CLIENT_ID`. Override it if your provider uses a different `aud` claim:

```bash
OIDC_AUDIENCE=https://api.yourcompany.com
```

### 4. Optional: issuer override

If the `iss` claim in tokens differs from `OIDC_ISSUER_URL` (common with some providers):

```bash
OIDC_ISSUER=https://auth.yourcompany.com
```

## Role-Based Access

By default, new OIDC users receive **readonly** access. The first user to log in is automatically granted admin. To grant admin access to additional users, you have two options:

### Option A: Promote via the admin UI

An existing admin can promote other users from the **Users** page in the dashboard.

### Option B: Use an OIDC claim

Configure uxrr to check a JWT claim for admin status:

```bash
OIDC_ADMIN_CLAIM=roles
OIDC_ADMIN_VALUE=uxrr-admin
```

The claim is looked up as a direct top-level key in the JWT payload. If the claim value is an array, uxrr checks whether it includes the configured value; if it's a string, it checks for an exact match. Users whose token matches the claim are granted admin on first login.

> **Note:** Admin status is stored in the database at user creation time and is not re-evaluated on subsequent logins. To change a user's admin status after creation, use the admin UI.

## Dev Mode

For development or quick evaluation:

```bash
UXRR_DEV_MODE=true
```

This disables OIDC entirely — the dashboard is accessible without authentication. Dev mode is ignored when `NODE_ENV=production` as a safety guard. **Never use dev mode in production.**

## Provider-Specific Notes

### Keycloak

- Create a client in your realm with **Client authentication** off (public client)
- Set **Valid redirect URIs** and **Web origins**
- `OIDC_ISSUER_URL` is typically `https://keycloak.example.com/realms/your-realm`

### Auth0

- Create a **Single Page Application**
- Add your uxrr URL to **Allowed Callback URLs** and **Allowed Logout URLs**
- `OIDC_ISSUER_URL` is `https://your-tenant.auth0.com`
- Set `OIDC_AUDIENCE` to your API identifier if using custom APIs

### Google

- Create an **OAuth 2.0 Client ID** (Web application type)
- `OIDC_ISSUER_URL` is `https://accounts.google.com`
- `OIDC_CLIENT_ID` is the client ID from Google Cloud Console
