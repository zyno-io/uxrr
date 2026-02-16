#!/usr/bin/env node

// OTEL must init before any other imports
import('@zyno-io/dk-server-foundation/telemetry/otel/index.js').then(async otel => {
    otel.init();
    await import('./app.js');
});
