const STYLE_ID = 'uxrr-support-chat-style';

const CSS = `
.uxrr-chat {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 320px;
    max-height: 420px;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.15);
    display: flex;
    flex-direction: column;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    overflow: hidden;
}

.uxrr-chat.uxrr-chat--minimized .uxrr-chat-expanded {
    display: none;
}

.uxrr-chat:not(.uxrr-chat--minimized) .uxrr-chat-fab {
    display: none;
}

.uxrr-chat.uxrr-chat--minimized {
    width: auto;
    max-height: none;
    border-radius: 50%;
}

.uxrr-chat-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: #3b82f6;
    color: #fff;
    font-weight: 600;
    cursor: pointer;
    user-select: none;
}

.uxrr-chat-header span {
    font-size: 13px;
}

.uxrr-chat-minimize {
    background: none;
    border: none;
    color: #fff;
    font-size: 18px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
}

.uxrr-chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    min-height: 200px;
    max-height: 280px;
}

.uxrr-chat-msg {
    margin-bottom: 8px;
    display: flex;
    flex-direction: column;
}

.uxrr-chat-msg--agent {
    align-items: flex-start;
}

.uxrr-chat-msg--user {
    align-items: flex-end;
}

.uxrr-chat-bubble {
    max-width: 80%;
    padding: 8px 12px;
    border-radius: 12px;
    line-height: 1.4;
    word-wrap: break-word;
    white-space: pre-wrap;
}

.uxrr-chat-msg--agent .uxrr-chat-bubble {
    background: #f1f5f9;
    color: #1e293b;
}

.uxrr-chat-msg--user .uxrr-chat-bubble {
    background: #3b82f6;
    color: #fff;
}

.uxrr-chat-label {
    font-size: 11px;
    color: #94a3b8;
    margin-bottom: 2px;
    padding: 0 4px;
}

.uxrr-chat-input {
    display: flex;
    border-top: 1px solid #e2e8f0;
    padding: 8px;
    gap: 8px;
}

.uxrr-chat-input input {
    flex: 1;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 14px;
    outline: none;
}

.uxrr-chat-input input:focus {
    border-color: #3b82f6;
}

.uxrr-chat-input button {
    background: #3b82f6;
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 8px 16px;
    font-size: 14px;
    cursor: pointer;
}

.uxrr-chat-input button:hover {
    background: #2563eb;
}

.uxrr-chat-typing {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    margin-bottom: 8px;
}

.uxrr-chat-typing-bubble {
    background: #f1f5f9;
    border-radius: 12px;
    padding: 10px 14px;
    display: flex;
    gap: 4px;
    align-items: center;
}

.uxrr-chat-typing-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #94a3b8;
    animation: uxrr-typing-bounce 1.4s infinite ease-in-out;
}

.uxrr-chat-typing-dot:nth-child(2) {
    animation-delay: 0.2s;
}

.uxrr-chat-typing-dot:nth-child(3) {
    animation-delay: 0.4s;
}

@keyframes uxrr-typing-bounce {
    0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
    30% { transform: translateY(-4px); opacity: 1; }
}

.uxrr-chat-fab {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: #3b82f6;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 24px;
    border: none;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
}
`;

export class SupportChat {
    private container: HTMLDivElement;
    private messagesEl!: HTMLDivElement;
    private inputAreaEl!: HTMLDivElement;
    private typingEl!: HTMLDivElement;
    private headerBtnEl!: HTMLButtonElement;
    private typingTimeout: ReturnType<typeof setTimeout> | null = null;
    private minimized = false;
    private enabled = true;
    private onSend: (message: string) => void;
    private onTyping: () => void;
    private onDestroy: (() => void) | null;

    constructor(onSend: (message: string) => void, onTyping: () => void, onDestroy?: () => void) {
        this.onSend = onSend;
        this.onTyping = onTyping;
        this.onDestroy = onDestroy ?? null;

        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = CSS;
            document.head.appendChild(style);
        }

        this.container = document.createElement('div');
        this.container.className = 'uxrr-chat';
        document.body.appendChild(this.container);

        this.buildDOM();
    }

    addMessage(message: string, from: string): void {
        message = message.slice(0, 2000);
        if (this.minimized) {
            this.setMinimized(false);
        }

        if (from !== 'user') {
            this.hideTypingIndicator();
        }

        const isAgent = from !== 'user';
        const wrapper = document.createElement('div');
        wrapper.className = `uxrr-chat-msg uxrr-chat-msg--${isAgent ? 'agent' : 'user'}`;

        const label = document.createElement('div');
        label.className = 'uxrr-chat-label';
        label.textContent = isAgent ? from : 'You';

        const bubble = document.createElement('div');
        bubble.className = 'uxrr-chat-bubble';
        bubble.textContent = message;

        wrapper.appendChild(label);
        wrapper.appendChild(bubble);

        // Insert before typing indicator so it stays at the bottom
        this.messagesEl.insertBefore(wrapper, this.typingEl);
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }

    showTypingIndicator(): void {
        this.typingEl.style.display = '';
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
        if (this.typingTimeout) clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
            this.hideTypingIndicator();
        }, 3000);
    }

    private hideTypingIndicator(): void {
        this.typingEl.style.display = 'none';
        if (this.typingTimeout) {
            clearTimeout(this.typingTimeout);
            this.typingTimeout = null;
        }
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        this.inputAreaEl.style.display = enabled ? '' : 'none';
        this.headerBtnEl.textContent = enabled ? '\u2212' : '\u2715';
        this.hideTypingIndicator();
    }

    destroy(): void {
        if (this.typingTimeout) clearTimeout(this.typingTimeout);
        this.container.remove();
        this.onDestroy?.();
    }

    private buildDOM(): void {
        // FAB (visible only when minimized, via CSS)
        const fab = document.createElement('button');
        fab.className = 'uxrr-chat-fab';
        fab.textContent = '\u{1F4AC}';
        fab.onclick = () => this.setMinimized(false);
        this.container.appendChild(fab);

        // Expanded wrapper (hidden when minimized, via CSS)
        const expanded = document.createElement('div');
        expanded.className = 'uxrr-chat-expanded';

        // Header
        const header = document.createElement('div');
        header.className = 'uxrr-chat-header';

        const title = document.createElement('span');
        title.textContent = 'Support Connected';
        header.appendChild(title);

        this.headerBtnEl = document.createElement('button');
        this.headerBtnEl.className = 'uxrr-chat-minimize';
        this.headerBtnEl.textContent = '\u2212';
        this.headerBtnEl.onclick = e => {
            e.stopPropagation();
            if (this.enabled) {
                this.setMinimized(true);
            } else {
                this.destroy();
            }
        };
        header.appendChild(this.headerBtnEl);

        expanded.appendChild(header);

        // Messages
        this.messagesEl = document.createElement('div');
        this.messagesEl.className = 'uxrr-chat-messages';
        expanded.appendChild(this.messagesEl);

        // Typing indicator (hidden by default)
        this.typingEl = document.createElement('div');
        this.typingEl.className = 'uxrr-chat-typing';
        this.typingEl.style.display = 'none';
        const typingBubble = document.createElement('div');
        typingBubble.className = 'uxrr-chat-typing-bubble';
        for (let i = 0; i < 3; i++) {
            const dot = document.createElement('span');
            dot.className = 'uxrr-chat-typing-dot';
            typingBubble.appendChild(dot);
        }
        this.typingEl.appendChild(typingBubble);
        this.messagesEl.appendChild(this.typingEl);

        // Input
        this.inputAreaEl = document.createElement('div');
        this.inputAreaEl.className = 'uxrr-chat-input';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Type a message...';
        input.maxLength = 2000;

        const sendBtn = document.createElement('button');
        sendBtn.textContent = 'Send';

        const doSend = () => {
            const text = input.value.trim();
            if (!text) return;
            input.value = '';
            this.addMessage(text, 'user');
            this.onSend(text);
        };

        sendBtn.onclick = doSend;
        input.onkeydown = e => {
            e.stopPropagation();
            if (e.key === 'Enter') doSend();
        };
        input.onkeyup = e => e.stopPropagation();
        input.onkeypress = e => e.stopPropagation();
        input.oninput = () => this.onTyping();

        this.inputAreaEl.appendChild(input);
        this.inputAreaEl.appendChild(sendBtn);
        expanded.appendChild(this.inputAreaEl);

        this.container.appendChild(expanded);
    }

    private setMinimized(minimized: boolean): void {
        this.minimized = minimized;
        this.container.classList.toggle('uxrr-chat--minimized', minimized);
    }
}
