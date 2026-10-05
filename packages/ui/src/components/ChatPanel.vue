<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';

import { createLogger } from '@/logger';

const log = createLogger('chat');

export interface ChatMessage {
    message: string;
    from: string;
    timestamp: number;
}

const props = defineProps<{
    messages: ChatMessage[];
    chatStarted: boolean;
    chatActive: boolean;
    clientConnected: boolean;
    userTyping: boolean;
    readonly?: boolean;
}>();

const emit = defineEmits<{
    send: [message: string];
    'start-chat': [];
    'end-chat': [];
    typing: [];
}>();

const containerRef = ref<HTMLDivElement>();
const textareaRef = ref<HTMLTextAreaElement>();
const inputText = ref('');

watch(
    () => props.chatActive,
    async active => {
        if (active) {
            await nextTick();
            textareaRef.value?.focus();
        }
    }
);

watch([() => props.messages.length, () => props.userTyping], async () => {
    await nextTick();
    if (containerRef.value) {
        containerRef.value.scrollTop = containerRef.value.scrollHeight;
    }
});

function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doSend();
    }
}

function doSend() {
    const text = inputText.value.trim();
    if (!text) return;
    log.log('sending message, length:', text.length);
    inputText.value = '';
    emit('send', text);
}

function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

function formatSender(from: string): string {
    if (from === 'user') return 'User';
    if (from === 'agent') return 'Agent';
    return from;
}
</script>

<template>
    <div class="chat-panel">
        <template v-if="readonly">
            <div class="chat-toolbar">
                <span class="chat-title">Chat History</span>
                <span class="chat-count">{{ messages.length }} messages</span>
            </div>
            <div ref="containerRef" class="chat-messages">
                <div v-if="messages.length === 0" class="chat-empty">No messages</div>
                <template v-for="(msg, i) in messages" :key="i">
                    <div v-if="msg.from === '__separator'" class="chat-separator">
                        <span>Chat restarted</span>
                    </div>
                    <div v-else :class="['chat-msg', msg.from === 'user' ? 'chat-msg--user' : 'chat-msg--agent']">
                        <div class="chat-meta">
                            <span class="chat-from">{{ formatSender(msg.from) }}</span>
                            <span class="chat-time">{{ formatTime(msg.timestamp) }}</span>
                        </div>
                        <div class="chat-bubble">{{ msg.message }}</div>
                    </div>
                </template>
            </div>
        </template>
        <template v-else-if="!chatStarted">
            <div class="chat-start">
                <p class="chat-start-desc">Open a chat widget on the user's screen</p>
                <button class="btn primary chat-start-btn" :disabled="!clientConnected" @click="emit('start-chat')">Start Chat</button>
            </div>
        </template>
        <template v-else>
            <div class="chat-toolbar">
                <span class="chat-title">Chat</span>
                <span class="chat-count">{{ messages.length }} messages</span>
                <button v-if="chatActive" class="btn sm danger chat-end-btn" @click="emit('end-chat')">End Chat</button>
            </div>
            <div ref="containerRef" class="chat-messages">
                <div v-if="messages.length === 0" class="chat-empty">No messages yet</div>
                <template v-for="(msg, i) in messages" :key="i">
                    <div v-if="msg.from === '__separator'" class="chat-separator">
                        <span>Chat restarted</span>
                    </div>
                    <div v-else :class="['chat-msg', msg.from === 'user' ? 'chat-msg--user' : 'chat-msg--agent']">
                        <div class="chat-meta">
                            <span class="chat-from">{{ formatSender(msg.from) }}</span>
                            <span class="chat-time">{{ formatTime(msg.timestamp) }}</span>
                        </div>
                        <div class="chat-bubble">{{ msg.message }}</div>
                    </div>
                </template>
                <div v-if="userTyping" class="chat-typing">
                    <div class="chat-typing-bubble">
                        <span class="chat-typing-dot" />
                        <span class="chat-typing-dot" />
                        <span class="chat-typing-dot" />
                    </div>
                </div>
            </div>
            <div v-if="chatActive" class="chat-input">
                <textarea
                    class="input"
                    ref="textareaRef"
                    v-model="inputText"
                    placeholder="Type a message..."
                    rows="1"
                    @keydown="onKeydown"
                    @input="emit('typing')"
                />
                <button class="btn primary" @click="doSend">Send</button>
            </div>
            <div v-else-if="clientConnected" class="chat-ended">
                <button class="btn primary chat-start-btn" @click="emit('start-chat')">Restart Chat</button>
            </div>
        </template>
    </div>
</template>

<style scoped lang="scss">
.chat-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--surface);
    border-radius: var(--radius);
    overflow: hidden;
}

.chat-start {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 12px;
    padding: 24px;
}

.chat-start-desc {
    color: var(--text-3);
    font-size: 13px;
    margin: 0;
}

.chat-toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
}

.chat-title {
    font-weight: 600;
    font-size: 13px;
}

.chat-count {
    color: var(--text-3);
    font-size: 12px;
}

.chat-end-btn {
    margin-left: auto;
}

.chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
}

.chat-empty {
    text-align: center;
    color: var(--text-3);
    padding: 24px;
}

.chat-separator {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 12px 0;
    color: var(--text-3);
    font-size: 11px;

    &::before,
    &::after {
        content: '';
        flex: 1;
        height: 1px;
        background: var(--border);
    }
}

.chat-ended {
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
    text-align: center;
}

.chat-msg {
    margin-bottom: 12px;
}

.chat-msg--user {
    .chat-bubble {
        background: var(--accent-soft);
        border-left: 3px solid var(--accent);
    }
}

.chat-msg--agent {
    .chat-bubble {
        background: var(--success-soft);
        border-left: 3px solid var(--success);
    }
}

.chat-meta {
    display: flex;
    gap: 8px;
    margin-bottom: 4px;
    font-size: 11px;
    color: var(--text-3);
}

.chat-from {
    font-weight: 600;
}

.chat-bubble {
    padding: 8px 12px;
    border-radius: var(--radius);
    font-size: 13px;
    line-height: 1.5;
    word-break: break-word;
    white-space: pre-wrap;
}

.chat-typing {
    margin-bottom: 12px;
}

.chat-typing-bubble {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    padding: 8px 14px;
    border-radius: var(--radius);
    background: var(--accent-soft);
    border-left: 3px solid var(--accent);
}

.chat-typing-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-3);
    animation: typing-bounce 1.4s infinite ease-in-out;

    &:nth-child(2) {
        animation-delay: 0.2s;
    }

    &:nth-child(3) {
        animation-delay: 0.4s;
    }
}

@keyframes typing-bounce {
    0%,
    60%,
    100% {
        transform: translateY(0);
        opacity: 0.4;
    }
    30% {
        transform: translateY(-3px);
        opacity: 1;
    }
}

.chat-input {
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;

    textarea {
        flex: 1;
        height: auto;
        padding: 6px 10px;
        resize: none;
        line-height: 1.4;
        min-height: 32px;
    }
}
</style>
