import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import { openapiClientGeneratorPlugin } from '@zyno-io/vue-foundation/vite-plugins';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [vue(), openapiClientGeneratorPlugin()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url))
        }
    },
    build: {
        outDir: '../api/static'
    },
    server: {
        port: 8978,
        proxy: {
            '/v1': {
                target: 'http://localhost:8977',
                // target: 'https://uxrr.s24.dev',
                ws: true

                // secure: false,
                // changeOrigin: true
            }
        }
    },
    preview: {
        proxy: {
            '/v1': {
                target: 'http://localhost:8977',
                ws: true
            }
        }
    }
});
