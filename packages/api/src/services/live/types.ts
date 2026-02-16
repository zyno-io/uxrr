import type WebSocket from 'ws';

import type { IngestLogEntry } from '../ingest.service';

export interface LiveMessage {
    type: string;
    [key: string]: unknown;
}

export interface IChatMessage {
    message: string;
    from: string;
    timestamp: number;
    userId?: string;
}

export interface AgentConnection {
    ws: WebSocket;
    email: string;
    name?: string;
    userId?: string;
    lastPong: number;
}

export interface AgentPublicInfo {
    id: string;
    email: string;
    name?: string;
    isController: boolean;
}

export type RedisSessionMessage =
    | { sourcePod: string; kind: 'relay'; target: 'agents' | 'client'; message: LiveMessage }
    | { sourcePod: string; kind: 'agents_sync'; agents: AgentPublicInfo[] }
    | { sourcePod: string; kind: 'controller_update'; agentId?: string; podId?: string; email?: string };

export interface SessionConnections {
    appId?: string;
    clientWs?: WebSocket;
    clientLastPong?: number;
    agents: Map<string, AgentConnection>;
    controllerId?: string;
    globalControllerId?: string;
    globalControllerPodId?: string;
    globalControllerEmail?: string;
    remoteAgents: Map<string, AgentPublicInfo[]>;
    localConnectionCount: number;
    chatMessages: IChatMessage[];
    chatPersisted: boolean;
    chatDirty: boolean;
    chatPersistTimer?: ReturnType<typeof setTimeout>;
    pendingEvents: unknown[];
    pendingLogs: IngestLogEntry[];
    clientConnectedNotified: boolean;
    flushTimer?: ReturnType<typeof setInterval>;
    pingTimer?: ReturnType<typeof setInterval>;
}

export const FLUSH_INTERVAL_MS = 5_000;
export const CHAT_PERSIST_DELAY_MS = 60_000;
export const FLUSH_EVENT_THRESHOLD = 50;
export const FLUSH_LOG_THRESHOLD = 50;
export const PING_INTERVAL_MS = 15_000;
export const PONG_TIMEOUT_MS = 10_000;
export const CHANNEL_DATA_PREFIX = 'uxrr:live:data:';

export function createSessionConnections(): SessionConnections {
    return {
        agents: new Map(),
        remoteAgents: new Map(),
        localConnectionCount: 0,
        clientConnectedNotified: false,
        chatMessages: [],
        chatPersisted: false,
        chatDirty: false,
        pendingEvents: [],
        pendingLogs: []
    };
}
