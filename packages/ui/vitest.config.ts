import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [vue()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url))
        }
    },
    test: {
        environment: 'happy-dom',
        include: ['src/__tests__/**/*.spec.ts'],
        server: {
            deps: {
                inline: ['@zyno-io/vue-foundation']
            }
        }
    }
});
