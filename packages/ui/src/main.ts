import { createApp } from 'vue';
import { installVf } from '@zyno-io/vue-foundation';
import '@zyno-io/vue-foundation/dist/vue-foundation.css';

import { authState, consumeReturnUrl, initAuth } from './auth';
import { initEmbed } from './embed';
import { createLogger } from './logger';
import App from './App.vue';
import { router } from './router';

const log = createLogger('main');

async function bootstrap() {
    log.log('bootstrap started');

    if (window.location.pathname.startsWith('/embed')) {
        log.log('embed mode detected, initializing embed');
        initEmbed();
    }

    log.log('initializing auth');
    await initAuth();
    log.log('auth initialized, loading openapi client');
    await import('./openapi-client');

    const app = createApp(App);
    installVf(app);
    app.use(router);
    app.mount('#app');
    log.log('app mounted');

    await router.isReady();
    log.log('router ready, current route:', router.currentRoute.value.name);

    if (authState.oidcEnabled && authState.user && router.currentRoute.value.name === 'auth-callback') {
        const returnUrl = consumeReturnUrl();
        log.log('OIDC callback detected, redirecting to:', returnUrl);
        await router.replace(returnUrl);
    }

    log.log('bootstrap complete');
}

bootstrap();
