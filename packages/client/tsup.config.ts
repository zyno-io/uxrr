import { defineConfig } from 'tsup';

export default defineConfig([
    {
        entry: ['src/index.ts'],
        format: ['esm'],
        dts: true,
        sourcemap: true,
        clean: true,
        splitting: true,
        platform: 'browser',
        noExternal: [/./],
        metafile: true
    },
    {
        entry: ['src/index.ts'],
        format: ['cjs'],
        sourcemap: true,
        splitting: false,
        platform: 'browser',
        noExternal: [/./],
        metafile: true
    }
]);
