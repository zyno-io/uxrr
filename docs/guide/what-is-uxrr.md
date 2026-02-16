# What Is uxrr

uxrr (User eXperience Realtime & Rewind) is a self-hosted platform for recording and replaying user sessions in web applications. It captures DOM changes, console logs, and network requests, and provides a dashboard for your team to search, replay, and debug user sessions. (SaaS version coming soon.)

## Key Capabilities

**Session Recording** — uxrr uses [rrweb](https://github.com/rrweb-io/rrweb) to record DOM mutations in the browser. Sessions are replayed pixel-perfectly in the dashboard, including scroll position, mouse movement, and input interactions. Text content and inputs are masked by default for privacy.

<div class="screenshot">

![Session list](/screenshots/session-list.png)

</div>

**Console Logs** — Console warnings, errors, and assertions are captured alongside session events and displayed in a searchable panel during replay. Additional levels can be enabled via configuration.

<div class="screenshot">

![Session replay with console logs](/screenshots/session-detail-console.png)

</div>

**Network Tracing** — HTTP requests are instrumented via OpenTelemetry. Timing, status codes, and URLs are always captured. Headers and bodies can be opted into via configuration.

<div class="screenshot">

![Network request panel](/screenshots/session-detail-network.png)

</div>

**Live Sessions** — Agents (your team) can connect to active user sessions in real time. This includes:

- Live session replay (watching the user's screen as they use it)
- Cursor sharing (the user sees the agent's cursor)
- Screen annotations (highlight, pen tools)
- In-session chat

<div class="screenshot">

![Live session with chat](/screenshots/session-live-chat.png)

</div>

**Embeddable Views** — Session lists and replay can be embedded in your own applications via iframes using signed embed tokens, or accessed directly via REST API with API keys.

## How It Works

uxrr has three components:

1. **Browser SDK** (`@zyno-io/uxrr-client`) — a lightweight JavaScript library you add to your web application. It records sessions and sends data to the server.

2. **Server** (`@zyno-io/uxrr-api`) — receives ingested data from the SDK, stores it across PostgreSQL (session metadata), S3 (events), Loki (logs), and Tempo (traces), and serves the API.

3. **Dashboard** (`@zyno-io/uxrr-ui`) — a Vue-based admin UI for searching sessions, replaying recordings, viewing logs and network requests, and interacting with live users.

## License

uxrr is **source-available** under the uxrr Source Available License. It is free for internal use within your organization. A [commercial license](mailto:support@sgnl24.com) is required to offer it as a hosted service, distribute it, or embed it in products sold to others.

<style>
.screenshot {
    margin: 24px 0 32px;
}
.screenshot img {
    border-radius: 8px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
}
</style>
