#!/usr/bin/env node

// OTEL must init before any other imports
import('@zyno-io/ts-server-foundation/otel').then(async otel => {
    // Embed tokens arrive as /embed?token= (iframe src); older clients send ?embed_token= / ?ws_token=
    otel.init({ redactQueryKeys: ['token', 'embed_token', 'ws_token'] });
    await import('./app.js');
});
