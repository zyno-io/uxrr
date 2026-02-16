import { ScopedLogger } from '@deepkit/logger';
import { createRedis, disconnectAllRedis } from '@zyno-io/dk-server-foundation';
import Redis from 'ioredis';

import { UxrrConfig } from '../config';

type MessageHandler = (channel: string, message: string) => void;

export class RedisService {
    private readonly cmd?: Redis;
    private readonly sub?: Redis;
    private readonly handlers = new Map<string, Set<MessageHandler>>();
    private _connected = false;

    get enabled(): boolean {
        return !!this.cmd;
    }

    get connected(): boolean {
        return this._connected;
    }

    constructor(
        private readonly config: UxrrConfig,
        private readonly logger: ScopedLogger
    ) {
        if (!config.REDIS_HOST && !config.REDIS_SENTINEL_HOST) return;

        const { client: cmd } = createRedis();
        const { client: sub } = createRedis();
        this.cmd = cmd;
        this.sub = sub;

        this.cmd.on('connect', () => {
            this._connected = true;
            this.logger.info('Redis command connection established');
        });
        this.cmd.on('error', err => {
            this._connected = false;
            this.logger.error('Redis command connection error', err);
        });
        this.cmd.on('close', () => {
            this._connected = false;
        });

        this.sub.on('error', err => {
            this.logger.error('Redis subscriber connection error', err);
        });

        this.sub.on('message', (channel: string, message: string) => {
            const channelHandlers = this.handlers.get(channel);
            if (!channelHandlers) return;
            for (const handler of channelHandlers) {
                try {
                    handler(channel, message);
                } catch (err) {
                    this.logger.error(`Error in Redis message handler for ${channel}`, err);
                }
            }
        });
    }

    // ── Pub/Sub ────────────────────────────────────────────────────────

    async publish(channel: string, data: unknown): Promise<void> {
        if (!this.cmd) return;
        try {
            await this.cmd.publish(channel, JSON.stringify(data));
        } catch (err) {
            this.logger.error(`Failed to publish to ${channel}`, err);
        }
    }

    async subscribe(channel: string, handler: MessageHandler): Promise<void> {
        if (!this.sub) return;
        let channelHandlers = this.handlers.get(channel);
        if (!channelHandlers) {
            channelHandlers = new Set();
            this.handlers.set(channel, channelHandlers);
            channelHandlers.add(handler);
            await this.sub.subscribe(channel);
        } else {
            channelHandlers.add(handler);
        }
    }

    async unsubscribe(channel: string, handler?: MessageHandler): Promise<void> {
        if (!this.sub) return;
        const channelHandlers = this.handlers.get(channel);
        if (!channelHandlers) return;
        if (handler) {
            channelHandlers.delete(handler);
            if (channelHandlers.size > 0) return;
        }
        this.handlers.delete(channel);
        await this.sub.unsubscribe(channel);
    }

    // ── Key operations ─────────────────────────────────────────────────

    async setex(key: string, seconds: number, value: string): Promise<void> {
        if (!this.cmd) return;
        await this.cmd.setex(key, seconds, value);
    }

    async exists(key: string): Promise<boolean> {
        if (!this.cmd) return false;
        return (await this.cmd.exists(key)) === 1;
    }

    async sadd(key: string, ...members: string[]): Promise<void> {
        if (!this.cmd) return;
        await this.cmd.sadd(key, ...members);
    }

    async srem(key: string, ...members: string[]): Promise<void> {
        if (!this.cmd) return;
        await this.cmd.srem(key, ...members);
    }

    async smembers(key: string): Promise<string[]> {
        if (!this.cmd) return [];
        return this.cmd.smembers(key);
    }

    async del(...keys: string[]): Promise<void> {
        if (!this.cmd) return;
        await this.cmd.del(...keys);
    }

    // ── Shutdown ───────────────────────────────────────────────────────

    async shutdown(): Promise<void> {
        await disconnectAllRedis();
    }
}
