import type { eventWithTime } from '@rrweb/types';

import Player from 'rrweb-player';
import { describe, expect, it } from 'vitest';

interface RRWebPlayerInstance {
    $destroy(): void;
    getReplayer(): unknown;
}

const PlayerCtor = Player as unknown as new (options: Record<string, unknown>) => RRWebPlayerInstance;

const events = [
    {
        type: 4,
        timestamp: 1_000,
        data: { href: 'https://example.com', width: 800, height: 600 }
    },
    {
        type: 2,
        timestamp: 1_001,
        data: {
            node: {
                type: 0,
                id: 1,
                childNodes: [
                    {
                        type: 2,
                        id: 2,
                        tagName: 'html',
                        attributes: {},
                        childNodes: [
                            {
                                type: 2,
                                id: 3,
                                tagName: 'body',
                                attributes: {},
                                childNodes: []
                            }
                        ]
                    }
                ]
            },
            initialOffset: { top: 0, left: 0 }
        }
    }
] as eventWithTime[];

describe('rrweb-player package patch', () => {
    it('initializes the replayer from the published stable bundle', () => {
        const target = document.createElement('div');
        document.body.append(target);

        const player = new PlayerCtor({
            target,
            props: {
                events,
                width: 800,
                height: 600,
                autoPlay: false
            }
        });

        expect(player.getReplayer()).toBeDefined();

        player.$destroy();
        target.remove();
    });
});
