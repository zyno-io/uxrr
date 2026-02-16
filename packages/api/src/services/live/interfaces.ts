import type { IngestLogEntry } from '../ingest.service';
import type { AgentPublicInfo, IChatMessage, LiveMessage } from './types';

/**
 * Transport layer for delivering messages to clients and agents.
 * The implementation decides whether to send locally, via Redis, or both.
 * LiveSessionStream calls these methods without knowing about pods or network topology.
 */
export interface ISessionTransport {
    /** Send a message to the client SDK for a given session. */
    sendToClient(sessionId: string, msg: LiveMessage): void;

    /** Send a message to a specific agent by ID. */
    sendToAgent(sessionId: string, agentId: string, msg: LiveMessage): void;

    /** Broadcast a message to all agents (local + remote). Optionally exclude one agent. */
    broadcastToAgents(sessionId: string, msg: LiveMessage, excludeAgentId?: string): void;

    /** Broadcast the current agent list to all local agents. */
    broadcastAgentList(sessionId: string, agents: AgentPublicInfo[]): void;

    /** Notify remote pods that the controller has changed. */
    publishControllerUpdate(sessionId: string, agentId: string | undefined, email: string | undefined): void;

    /** Sync this pod's local agent list to remote pods. */
    publishAgentSync(sessionId: string, localAgents: AgentPublicInfo[]): void;
}

/**
 * Persistence layer for flushing buffered data to storage.
 * LiveSessionStream accumulates events/logs/chat and periodically calls these.
 */
export interface IBufferPersistence {
    /** Persist a batch of rrweb events to S3. */
    persistEvents(sessionId: string, events: unknown[]): Promise<void>;

    /** Persist a batch of log entries to Loki. */
    persistLogs(sessionId: string, logs: IngestLogEntry[]): Promise<void>;

    /** Persist chat messages to S3. If markHasChat is true, also set hasChatMessages flag on the session. */
    persistChat(sessionId: string, messages: IChatMessage[], markHasChat: boolean): Promise<void>;
}
