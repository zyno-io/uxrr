import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ChatPanel from '../components/ChatPanel.vue';
import type { ChatMessage } from '../components/ChatPanel.vue';

// Mock the logger
vi.mock('@/logger', () => ({
    createLogger: () => ({ log: () => {} })
}));

function makeMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
    return {
        message: 'Hello',
        from: 'user',
        timestamp: 1700000000000,
        ...overrides
    };
}

describe('ChatPanel', () => {
    describe('readonly mode', () => {
        it('renders chat history title', () => {
            const wrapper = mount(ChatPanel, {
                props: {
                    messages: [],
                    chatStarted: false,
                    chatActive: false,
                    clientConnected: false,
                    userTyping: false,
                    readonly: true
                }
            });
            expect(wrapper.text()).toContain('Chat History');
        });

        it('shows message count', () => {
            const wrapper = mount(ChatPanel, {
                props: {
                    messages: [makeMsg(), makeMsg({ from: 'agent@test.com' })],
                    chatStarted: false,
                    chatActive: false,
                    clientConnected: false,
                    userTyping: false,
                    readonly: true
                }
            });
            expect(wrapper.text()).toContain('2 messages');
        });

        it('shows "No messages" when empty', () => {
            const wrapper = mount(ChatPanel, {
                props: {
                    messages: [],
                    chatStarted: false,
                    chatActive: false,
                    clientConnected: false,
                    userTyping: false,
                    readonly: true
                }
            });
            expect(wrapper.text()).toContain('No messages');
        });

        it('renders messages with sender labels', () => {
            const wrapper = mount(ChatPanel, {
                props: {
                    messages: [
                        makeMsg({ from: 'user', message: 'hi from user' }),
                        makeMsg({ from: 'admin@test.com', message: 'hi from agent' })
                    ],
                    chatStarted: false,
                    chatActive: false,
                    clientConnected: false,
                    userTyping: false,
                    readonly: true
                }
            });
            expect(wrapper.text()).toContain('User');
            expect(wrapper.text()).toContain('hi from user');
            expect(wrapper.text()).toContain('admin@test.com');
            expect(wrapper.text()).toContain('hi from agent');
        });

        it('renders chat separator', () => {
            const wrapper = mount(ChatPanel, {
                props: {
                    messages: [
                        makeMsg(),
                        makeMsg({ from: '__separator', message: '' }),
                        makeMsg({ from: 'user', message: 'after restart' })
                    ],
                    chatStarted: false,
                    chatActive: false,
                    clientConnected: false,
                    userTyping: false,
                    readonly: true
                }
            });
            expect(wrapper.find('.chat-separator').exists()).toBe(true);
            expect(wrapper.text()).toContain('Chat restarted');
        });
    });

    describe('not started mode', () => {
        it('shows start chat button', () => {
            const wrapper = mount(ChatPanel, {
                props: {
                    messages: [],
                    chatStarted: false,
                    chatActive: false,
                    clientConnected: true,
                    userTyping: false
                }
            });
            expect(wrapper.find('.chat-start-btn').exists()).toBe(true);
            expect(wrapper.text()).toContain('Start Chat');
        });

        it('start button is disabled when client not connected', () => {
            const wrapper = mount(ChatPanel, {
                props: {
                    messages: [],
                    chatStarted: false,
                    chatActive: false,
                    clientConnected: false,
                    userTyping: false
                }
            });
            const btn = wrapper.find('.chat-start-btn');
            expect(btn.attributes('disabled')).toBeDefined();
        });

        it('emits start-chat when button clicked', async () => {
            const wrapper = mount(ChatPanel, {
                props: {
                    messages: [],
                    chatStarted: false,
                    chatActive: false,
                    clientConnected: true,
                    userTyping: false
                }
            });
            await wrapper.find('.chat-start-btn').trigger('click');
            expect(wrapper.emitted('start-chat')).toBeTruthy();
        });
    });

    describe('active chat mode', () => {
        const activeProps = {
            messages: [] as ChatMessage[],
            chatStarted: true,
            chatActive: true,
            clientConnected: true,
            userTyping: false
        };

        it('shows textarea and send button', () => {
            const wrapper = mount(ChatPanel, { props: activeProps });
            expect(wrapper.find('textarea').exists()).toBe(true);
            expect(wrapper.find('.chat-input button').exists()).toBe(true);
        });

        it('emits send on button click', async () => {
            const wrapper = mount(ChatPanel, { props: activeProps });
            await wrapper.find('textarea').setValue('Hello!');
            await wrapper.find('.chat-input button').trigger('click');

            expect(wrapper.emitted('send')).toBeTruthy();
            expect(wrapper.emitted('send')![0]![0]).toBe('Hello!');
        });

        it('clears input after send', async () => {
            const wrapper = mount(ChatPanel, { props: activeProps });
            const textarea = wrapper.find('textarea');
            await textarea.setValue('Hello!');
            await wrapper.find('.chat-input button').trigger('click');

            expect((textarea.element as HTMLTextAreaElement).value).toBe('');
        });

        it('does not send empty messages', async () => {
            const wrapper = mount(ChatPanel, { props: activeProps });
            await wrapper.find('.chat-input button').trigger('click');
            expect(wrapper.emitted('send')).toBeFalsy();
        });

        it('does not send whitespace-only messages', async () => {
            const wrapper = mount(ChatPanel, { props: activeProps });
            await wrapper.find('textarea').setValue('   ');
            await wrapper.find('.chat-input button').trigger('click');
            expect(wrapper.emitted('send')).toBeFalsy();
        });

        it('emits typing on input', async () => {
            const wrapper = mount(ChatPanel, { props: activeProps });
            await wrapper.find('textarea').trigger('input');
            expect(wrapper.emitted('typing')).toBeTruthy();
        });

        it('shows end chat button', () => {
            const wrapper = mount(ChatPanel, { props: activeProps });
            expect(wrapper.find('.chat-end-btn').exists()).toBe(true);
        });

        it('emits end-chat on button click', async () => {
            const wrapper = mount(ChatPanel, { props: activeProps });
            await wrapper.find('.chat-end-btn').trigger('click');
            expect(wrapper.emitted('end-chat')).toBeTruthy();
        });

        it('shows typing indicator when user is typing', () => {
            const wrapper = mount(ChatPanel, {
                props: { ...activeProps, userTyping: true }
            });
            expect(wrapper.find('.chat-typing').exists()).toBe(true);
            expect(wrapper.findAll('.chat-typing-dot').length).toBe(3);
        });

        it('hides typing indicator when user is not typing', () => {
            const wrapper = mount(ChatPanel, {
                props: { ...activeProps, userTyping: false }
            });
            expect(wrapper.find('.chat-typing').exists()).toBe(false);
        });

        it('shows "No messages yet" when no messages', () => {
            const wrapper = mount(ChatPanel, { props: activeProps });
            expect(wrapper.text()).toContain('No messages yet');
        });
    });

    describe('ended chat mode', () => {
        it('shows restart button when chat ended but client connected', () => {
            const wrapper = mount(ChatPanel, {
                props: {
                    messages: [makeMsg()],
                    chatStarted: true,
                    chatActive: false,
                    clientConnected: true,
                    userTyping: false
                }
            });
            expect(wrapper.text()).toContain('Restart Chat');
        });
    });

    describe('message styling', () => {
        it('user messages have chat-msg--user class', () => {
            const wrapper = mount(ChatPanel, {
                props: {
                    messages: [makeMsg({ from: 'user' })],
                    chatStarted: true,
                    chatActive: true,
                    clientConnected: true,
                    userTyping: false
                }
            });
            expect(wrapper.find('.chat-msg--user').exists()).toBe(true);
        });

        it('agent messages have chat-msg--agent class', () => {
            const wrapper = mount(ChatPanel, {
                props: {
                    messages: [makeMsg({ from: 'admin@test.com' })],
                    chatStarted: true,
                    chatActive: true,
                    clientConnected: true,
                    userTyping: false
                }
            });
            expect(wrapper.find('.chat-msg--agent').exists()).toBe(true);
        });
    });
});
