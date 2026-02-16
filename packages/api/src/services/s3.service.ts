import {
    DeleteObjectsCommand,
    GetObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client
} from '@aws-sdk/client-s3';
import { gunzip, gzip } from 'node:zlib';
import { promisify } from 'node:util';

import { UxrrConfig } from '../config';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export class S3Service {
    private readonly client: S3Client;
    private readonly bucket: string;

    constructor(private readonly config: UxrrConfig) {
        this.client = new S3Client({
            endpoint: config.S3_ENDPOINT,
            region: config.S3_REGION,
            credentials:
                config.S3_ACCESS_KEY_SECRET && config.S3_SECRET_KEY_SECRET
                    ? {
                          accessKeyId: config.S3_ACCESS_KEY_SECRET,
                          secretAccessKey: config.S3_SECRET_KEY_SECRET
                      }
                    : undefined,
            forcePathStyle: config.S3_FORCE_PATH_STYLE
        });
        this.bucket = config.S3_BUCKET;
    }

    async putEvents(origin: string, sessionId: string, chunkIndex: number, data: unknown): Promise<void> {
        const key = this.buildKey(origin, sessionId, 'events', chunkIndex);
        const compressed = await gzipAsync(JSON.stringify(data));
        await this.putCompressed(key, compressed);
    }

    async putEventsCompressed(origin: string, sessionId: string, chunkIndex: number, compressedData: Buffer): Promise<void> {
        const key = this.buildKey(origin, sessionId, 'events', chunkIndex);
        await this.putCompressed(key, compressedData);
    }

    async getEvents(origin: string, sessionId: string): Promise<unknown[]> {
        return this.getChunks(origin, sessionId, 'events');
    }

    async putChat(origin: string, sessionId: string, messages: unknown[]): Promise<void> {
        const key = `${origin}/chat/${sessionId}.json`;
        await this.put(key, messages);
    }

    async getChat(origin: string, sessionId: string): Promise<unknown[]> {
        const key = `${origin}/chat/${sessionId}.json`;
        try {
            const result = await this.client.send(
                new GetObjectCommand({
                    Bucket: this.bucket,
                    Key: key
                })
            );
            if (result.Body) {
                let text: string;
                if (result.ContentEncoding === 'gzip') {
                    const bytes = await result.Body.transformToByteArray();
                    const decompressed = await gunzipAsync(Buffer.from(bytes));
                    text = decompressed.toString('utf-8');
                } else {
                    text = await result.Body.transformToString();
                }
                return JSON.parse(text);
            }
        } catch (err: unknown) {
            const s3Err = err as { name?: string; $metadata?: { httpStatusCode?: number } };
            if (s3Err.name === 'NoSuchKey' || s3Err.$metadata?.httpStatusCode === 404) {
                return [];
            }
            throw err;
        }
        return [];
    }

    async deleteSessionEvents(origin: string, sessionId: string): Promise<void> {
        await this.deleteByPrefix(`${origin}/${sessionId}/events/`);
    }

    async deleteSessionChat(origin: string, sessionId: string): Promise<void> {
        const key = `${origin}/chat/${sessionId}.json`;
        try {
            await this.client.send(
                new DeleteObjectsCommand({
                    Bucket: this.bucket,
                    Delete: { Objects: [{ Key: key }] }
                })
            );
        } catch {
            // Ignore if already deleted
        }
    }

    private async deleteByPrefix(prefix: string): Promise<void> {
        let continuationToken: string | undefined;

        do {
            const listResult = await this.client.send(
                new ListObjectsV2Command({
                    Bucket: this.bucket,
                    Prefix: prefix,
                    ContinuationToken: continuationToken
                })
            );

            const keys = (listResult.Contents ?? []).map(o => o.Key).filter(Boolean) as string[];
            if (keys.length > 0) {
                await this.client.send(
                    new DeleteObjectsCommand({
                        Bucket: this.bucket,
                        Delete: { Objects: keys.map(Key => ({ Key })) }
                    })
                );
            }

            continuationToken = listResult.IsTruncated ? listResult.NextContinuationToken : undefined;
        } while (continuationToken);
    }

    private buildKey(origin: string, sessionId: string, type: string, chunkIndex: number): string {
        const chunk = String(chunkIndex).padStart(6, '0');
        return `${origin}/${sessionId}/${type}/${chunk}.json`;
    }

    private async put(key: string, data: unknown): Promise<void> {
        const compressed = await gzipAsync(JSON.stringify(data));
        await this.putCompressed(key, compressed);
    }

    private async putCompressed(key: string, compressed: Buffer): Promise<void> {
        await this.client.send(
            new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: compressed,
                ContentType: 'application/json',
                ContentEncoding: 'gzip'
            })
        );
    }

    private async getChunks(origin: string, sessionId: string, type: string): Promise<unknown[]> {
        const prefix = `${origin}/${sessionId}/${type}/`;

        // Phase 1: List all keys (sequential pagination required by S3 API)
        const allKeys: string[] = [];
        let continuationToken: string | undefined;

        do {
            const listResult = await this.client.send(
                new ListObjectsV2Command({
                    Bucket: this.bucket,
                    Prefix: prefix,
                    ContinuationToken: continuationToken
                })
            );

            for (const obj of listResult.Contents ?? []) {
                if (obj.Key) allKeys.push(obj.Key);
            }

            continuationToken = listResult.IsTruncated ? listResult.NextContinuationToken : undefined;
        } while (continuationToken);

        allKeys.sort();

        if (allKeys.length === 0) return [];

        // Phase 2: Fetch in concurrent batches, maintaining sort order
        const CONCURRENCY = 10;
        const fetched: unknown[][] = Array.from<unknown[]>({ length: allKeys.length });

        for (let i = 0; i < allKeys.length; i += CONCURRENCY) {
            const batch = allKeys.slice(i, i + CONCURRENCY);
            const batchResults = await Promise.all(
                batch.map(async (key, batchIdx) => {
                    const getResult = await this.client.send(
                        new GetObjectCommand({
                            Bucket: this.bucket,
                            Key: key
                        })
                    );
                    if (getResult.Body) {
                        let text: string;
                        if (getResult.ContentEncoding === 'gzip') {
                            const bytes = await getResult.Body.transformToByteArray();
                            const decompressed = await gunzipAsync(Buffer.from(bytes));
                            text = decompressed.toString('utf-8');
                        } else {
                            text = await getResult.Body.transformToString();
                        }
                        const parsed = JSON.parse(text);
                        return { index: i + batchIdx, data: Array.isArray(parsed) ? parsed : [parsed] };
                    }
                    return { index: i + batchIdx, data: [] as unknown[] };
                })
            );

            for (const result of batchResults) {
                fetched[result.index] = result.data;
            }
        }

        // Flatten in sorted order
        const results: unknown[] = [];
        for (const chunk of fetched) {
            if (chunk) results.push(...chunk);
        }
        return results;
    }
}
