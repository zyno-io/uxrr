import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';

import { LiveSessionStream } from '../src/services/live/live-session-stream';
import type { ISessionTransport, IBufferPersistence } from '../src/services/live/interfaces';
import type { AgentPublicInfo, LiveMessage } from '../src/services/live/types';
import type { Logger } from '@deepkit/logger';

function makeLogger(): Logger {
    return { warn: mock.fn(), error: mock.fn(), info: mock.fn(), debug: mock.fn() } as unknown as Logger;
}

function makeTransport() {
    const sendToClient = mock.fn((_sid: string, _msg: LiveMessage) => {});
    const sendToAgent = mock.fn((_sid: string, _aid: string, _msg: LiveMessage) => {});
    const broadcastToAgents = mock.fn((_sid: string, _msg: LiveMessage, _exclude?: string) => {});
    const broadcastAgentList = mock.fn((_sid: string, _agents: AgentPublicInfo[]) => {});
    const publishControllerUpdate = mock.fn((_sid: string, _aid?: string, _email?: string) => {});
    const publishAgentSync = mock.fn((_sid: string, _agents: AgentPublicInfo[]) => {});

    const transport: ISessionTransport = {
        sendToClient,
        sendToAgent,
        broadcastToAgents,
        broadcastAgentList,
        publishControllerUpdate,
        publishAgentSync
    };

    return { transport, sendToClient, sendToAgent, broadcastToAgents, broadcastAgentList, publishControllerUpdate, publishAgentSync };
}

function makePersistence() {
    const persistEvents = mock.fn(async (_sid: string, _events: unknown[]) => {});
    const persistLogs = mock.fn(async (_sid: string, _logs: unknown[]) => {});
    const persistChat = mock.fn(async (_sid: string, _msgs: unknown[], _mark: boolean) => {});

    const persistence: IBufferPersistence = {
        persistEvents,
        persistLogs,
        persistChat
    };

    return { persistence, persistEvents, persistLogs, persistChat };
}

function createStream() {
    const t = makeTransport();
    const p = makePersistence();
    const stream = new LiveSessionStream(t.transport, p.persistence, makeLogger());
    return { stream, ...t, ...p };
}

describe('LiveSessionStream', () => {
    describe('client lifecycle', () => {
        it('notifies agents when client connects', () => {
            const { stream, broadcastToAgents } = createStream();
            stream.onAgentConnected('sess-1', 'a1', { email: 'agent@test.com' });
            stream.onClientConnected('sess-1', 'app-1');

            const calls = broadcastToAgents.mock.calls.filter(
                c => (c.arguments[1] as LiveMessage).type === 'client_connected'
            );
            assert.ok(calls.length > 0, 'Should broadcast client_connected to agents');
        });

        it('notifies agents when client disconnects', () => {
            const { stream, broadcastToAgents } = createStream();
            stream.onAgentConnected('sess-1', 'a1', { email: 'agent@test.com' });
            stream.onClientConnected('sess-1', 'app-1');
            stream.onClientDisconnected('sess-1');

            const calls = broadcastToAgents.mock.calls.filter(
                c => (c.arguments[1] as LiveMessage).type === 'client_disconnected'
            );
            assert.equal(calls.length, 1);
        });
    });

    describe('agent lifecycle', () => {
        it('first agent becomes controller', () => {
            const { stream, sendToAgent } = createStream();
            const result = stream.onAgentConnected('sess-1', 'a1', { email: 'agent@test.com' });

            assert.equal(result.isController, true);
            assert.equal(result.isFirstAgentAnywhere, true);

            const grantCalls = sendToAgent.mock.calls.filter(
                c => c.arguments[1] === 'a1' && (c.arguments[2] as LiveMessage).type === 'control_granted'
            );
            assert.equal(grantCalls.length, 1);
        });

        it('second agent does not become controller', () => {
            const { stream, sendToAgent } = createStream();
            stream.onAgentConnected('sess-1', 'a1', { email: 'agent1@test.com' });
            const result = stream.onAgentConnected('sess-1', 'a2', { email: 'agent2@test.com' });

            assert.equal(result.isController, false);
            assert.equal(result.isFirstAgentAnywhere, false);

            const revokeCalls = sendToAgent.mock.calls.filter(
                c => c.arguments[1] === 'a2' && (c.arguments[2] as LiveMessage).type === 'control_revoked'
            );
            assert.equal(revokeCalls.length, 1);
        });

        it('controller transfers on disconnect', () => {
            const { stream, sendToAgent } = createStream();
            stream.onAgentConnected('sess-1', 'a1', { email: 'agent1@test.com' });
            stream.onAgentConnected('sess-1', 'a2', { email: 'agent2@test.com' });

            stream.onAgentDisconnected('sess-1', 'a1');

            const grantCalls = sendToAgent.mock.calls.filter(
                c => c.arguments[1] === 'a2' && (c.arguments[2] as LiveMessage).type === 'control_granted'
            );
            assert.ok(grantCalls.length >= 1, 'a2 should receive control_granted after a1 disconnects');
        });

        it('notifies client when last agent disconnects', () => {
            const { stream, sendToClient } = createStream();
            stream.onClientConnected('sess-1', 'app-1');
            stream.onAgentConnected('sess-1', 'a1', { email: 'agent@test.com' });
            stream.onAgentDisconnected('sess-1', 'a1');

            const calls = sendToClient.mock.calls.filter(
                c => (c.arguments[1] as LiveMessage).type === 'agent_disconnected'
            );
            assert.equal(calls.length, 1);
        });
    });

    describe('snapshot handling', () => {
        it('requests fresh snapshot when agent connects with client present', () => {
            const { stream, sendToClient } = createStream();
            stream.onClientConnected('sess-1', 'app-1');
            stream.onAgentConnected('sess-1', 'a1', { email: 'agent@test.com' });

            const snapshotRequests = sendToClient.mock.calls.filter(
                c => (c.arguments[1] as LiveMessage).type === 'request_snapshot'
            );
            assert.equal(snapshotRequests.length, 1, 'Should request fresh snapshot from client');
        });

        it('does not send events directly to new agent', () => {
            const { stream, sendToAgent } = createStream();
            stream.onClientConnected('sess-1', 'app-1');
            stream.onAgentConnected('sess-1', 'a1', { email: 'agent@test.com' });

            // Agent should NOT receive events via sendToAgent (snapshot comes via broadcast)
            const eventsCalls = sendToAgent.mock.calls.filter(
                c => c.arguments[1] === 'a1' && (c.arguments[2] as LiveMessage).type === 'events'
            );
            assert.equal(eventsCalls.length, 0);
        });

        it('fresh snapshot response is broadcast to all agents', () => {
            const { stream, broadcastToAgents } = createStream();
            stream.onClientConnected('sess-1', 'app-1');
            stream.onAgentConnected('sess-1', 'a1', { email: 'agent@test.com' });

            // Simulate client responding to request_snapshot
            stream.onClientMessage('sess-1', {
                type: 'events',
                data: [
                    { type: 4, data: { width: 1024, height: 768 }, timestamp: 2000 },
                    { type: 2, timestamp: 2001 }
                ]
            });

            const eventsCalls = broadcastToAgents.mock.calls.filter(
                c => (c.arguments[1] as LiveMessage).type === 'events'
            );
            assert.ok(eventsCalls.length >= 1, 'Fresh snapshot should be broadcast to all agents');
        });
    });

    describe('agent message routing', () => {
        it('controller can forward messages to client', () => {
            const { stream, sendToClient } = createStream();
            stream.onClientConnected('sess-1', 'app-1');
            stream.onAgentConnected('sess-1', 'a1', { email: 'agent@test.com' });

            stream.onAgentMessage('sess-1', 'a1', { type: 'highlight', x: 100, y: 200 });

            const calls = sendToClient.mock.calls.filter(
                c => (c.arguments[1] as LiveMessage).type === 'highlight'
            );
            assert.equal(calls.length, 1);
        });

        it('non-controller cannot forward messages to client', () => {
            const { stream, sendToClient } = createStream();
            stream.onClientConnected('sess-1', 'app-1');
            stream.onAgentConnected('sess-1', 'a1', { email: 'agent1@test.com' });
            stream.onAgentConnected('sess-1', 'a2', { email: 'agent2@test.com' });

            stream.onAgentMessage('sess-1', 'a2', { type: 'highlight', x: 100, y: 200 });

            const calls = sendToClient.mock.calls.filter(
                c => (c.arguments[1] as LiveMessage).type === 'highlight'
            );
            assert.equal(calls.length, 0);
        });

        it('any agent can request take_control', () => {
            const { stream, sendToAgent } = createStream();
            stream.onAgentConnected('sess-1', 'a1', { email: 'agent1@test.com' });
            stream.onAgentConnected('sess-1', 'a2', { email: 'agent2@test.com' });

            stream.onAgentMessage('sess-1', 'a2', { type: 'take_control' });

            // a2 should get control_granted
            const grantCalls = sendToAgent.mock.calls.filter(
                c => c.arguments[1] === 'a2' && (c.arguments[2] as LiveMessage).type === 'control_granted'
            );
            assert.ok(grantCalls.length >= 1);

            // a1 should get control_revoked
            const revokeCalls = sendToAgent.mock.calls.filter(
                c => c.arguments[1] === 'a1' && (c.arguments[2] as LiveMessage).type === 'control_revoked'
            );
            assert.ok(revokeCalls.length >= 1);
        });

        it('agent chat messages are tagged with identity', () => {
            const { stream, sendToClient } = createStream();
            stream.onClientConnected('sess-1', 'app-1');
            stream.onAgentConnected('sess-1', 'a1', { email: 'admin@test.com', name: 'Admin' });

            stream.onAgentMessage('sess-1', 'a1', { type: 'chat', message: 'hello' });

            const chatCalls = sendToClient.mock.calls.filter(
                c => (c.arguments[1] as LiveMessage).type === 'chat'
            );
            assert.equal(chatCalls.length, 1);
            assert.equal((chatCalls[0].arguments[1] as Record<string, unknown>).from, 'Admin');
        });
    });

    describe('client message routing', () => {
        it('relays events to all agents', () => {
            const { stream, broadcastToAgents } = createStream();
            stream.onClientConnected('sess-1', 'app-1');
            stream.onAgentConnected('sess-1', 'a1', { email: 'agent@test.com' });

            stream.onClientMessage('sess-1', { type: 'events', data: [{ type: 3, timestamp: 1000 }] });

            const calls = broadcastToAgents.mock.calls.filter(
                c => (c.arguments[1] as LiveMessage).type === 'events'
            );
            assert.ok(calls.length >= 1);
        });

        it('buffers events for persistence', () => {
            const { stream, persistEvents } = createStream();
            stream.onClientConnected('sess-1', 'app-1');

            // Send 50 events to trigger flush
            const events = Array.from({ length: 50 }, (_, i) => ({ type: 3, timestamp: i }));
            stream.onClientMessage('sess-1', { type: 'events', data: events });

            assert.equal(persistEvents.mock.callCount(), 1);
        });
    });

    describe('remote state updates', () => {
        it('onRemoteAgentsSync updates agent list', () => {
            const { stream, broadcastAgentList } = createStream();
            stream.onAgentConnected('sess-1', 'a1', { email: 'local@test.com' });

            stream.onRemoteAgentsSync('sess-1', 'pod-2', [
                { id: 'r1', email: 'remote@test.com', isController: false }
            ]);

            // Should broadcast updated list that includes both local and remote
            const lastCall = broadcastAgentList.mock.calls[broadcastAgentList.mock.calls.length - 1];
            const agents = lastCall.arguments[1] as AgentPublicInfo[];
            assert.equal(agents.length, 2);
        });

        it('onRemoteControllerUpdate revokes local controller', () => {
            const { stream, sendToAgent } = createStream();
            stream.onAgentConnected('sess-1', 'a1', { email: 'local@test.com' });

            stream.onRemoteControllerUpdate('sess-1', 'remote-a1', 'pod-2', 'remote@test.com');

            const revokeCalls = sendToAgent.mock.calls.filter(
                c => c.arguments[1] === 'a1' && (c.arguments[2] as LiveMessage).type === 'control_revoked'
            );
            assert.ok(revokeCalls.length >= 1);
        });
    });

    describe('buffer management', () => {
        it('flushBuffers flushes events and logs', () => {
            const { stream, persistEvents, persistLogs } = createStream();
            stream.onClientConnected('sess-1', 'app-1');
            stream.onClientMessage('sess-1', { type: 'events', data: [{ type: 3 }] });
            stream.onClientMessage('sess-1', { type: 'logs', data: [{ t: 1, v: 1, c: 'test', m: 'msg' }] });

            stream.flushBuffers('sess-1');

            assert.equal(persistEvents.mock.callCount(), 1);
            assert.equal(persistLogs.mock.callCount(), 1);
        });
    });
});
