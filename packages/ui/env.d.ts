/// <reference types="vite/client" />

declare module '*.vue' {
    import type { DefineComponent } from 'vue';
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
    export default component;
}

declare module 'rrweb-player' {
    const Player: unknown;
    export default Player;
}

declare module 'rrweb-player/dist/style.css' {}
