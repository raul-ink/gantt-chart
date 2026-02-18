/**
 * chat.js — Chat panel UI and SSE streaming client
 *
 * Handles:
 *  - Sending messages to POST /api/chat (SSE response)
 *  - Rendering streamed agent responses
 *  - Detecting ```gantt-json blocks and firing 'gantt-ready' event
 *  - Showing/hiding the "Load Project" button
 */

const ChatManager = (() => {
    // Session ID persists for the browser tab
    const sessionId = crypto.randomUUID();

    let isStreaming = false;
    let pendingGanttData = null;

    // ── DOM refs ────────────────────────────────────────────────────────────
    const messagesEl = () => document.getElementById('chat-messages');
    const inputEl = () => document.getElementById('chat-input');
    const sendBtn = () => document.getElementById('chat-send-btn');
    const loadProjectArea = () => document.getElementById('chat-load-project');

    // ── Message rendering ────────────────────────────────────────────────────

    function appendMessage(role, text) {
        const wrapper = document.createElement('div');
        wrapper.className = `chat-message ${role}`;

        const label = document.createElement('div');
        label.className = 'message-label';
        label.textContent = role === 'user' ? 'You' : 'AI Planner';

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.textContent = text;

        wrapper.appendChild(label);
        wrapper.appendChild(bubble);
        messagesEl().appendChild(wrapper);
        scrollToBottom();
        return bubble;
    }

    function appendTypingIndicator() {
        const wrapper = document.createElement('div');
        wrapper.className = 'chat-message agent';
        wrapper.id = 'typing-indicator-wrapper';

        const label = document.createElement('div');
        label.className = 'message-label';
        label.textContent = 'AI Planner';

        const indicator = document.createElement('div');
        indicator.className = 'typing-indicator';
        indicator.innerHTML = `
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        `;

        wrapper.appendChild(label);
        wrapper.appendChild(indicator);
        messagesEl().appendChild(wrapper);
        scrollToBottom();
        return wrapper;
    }

    function removeTypingIndicator() {
        const el = document.getElementById('typing-indicator-wrapper');
        if (el) el.remove();
    }

    function scrollToBottom() {
        const el = messagesEl();
        el.scrollTop = el.scrollHeight;
    }

    // ── Gantt JSON detection ─────────────────────────────────────────────────

    /**
     * Extracts text to display (hides gantt-json code blocks)
     * and separately extracts the raw JSON string.
     */
    function processAgentResponse(fullText) {
        const ganttJsonPattern = /```gantt-json\s*([\s\S]*?)```/g;
        let match;
        let extractedJson = null;

        // Extract all gantt-json blocks
        while ((match = ganttJsonPattern.exec(fullText)) !== null) {
            try {
                extractedJson = JSON.parse(match[1].trim());
            } catch (e) {
                // malformed JSON, try next
            }
        }

        // Display text: replace gantt-json blocks with a placeholder
        const displayText = fullText
            .replace(/```gantt-json[\s\S]*?```/g, '[Gantt chart plan generated ✓]')
            .trim();

        return { displayText, ganttData: extractedJson };
    }

    // ── SSE streaming ────────────────────────────────────────────────────────

    async function sendMessage(message) {
        if (isStreaming || !message.trim()) return;

        isStreaming = true;
        setInputEnabled(false);

        // Render user message
        appendMessage('user', message);

        // Show typing indicator
        const typingWrapper = appendTypingIndicator();

        let fullResponse = '';
        let agentBubble = null;

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, message }),
            });

            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // keep incomplete line

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const raw = line.slice(6).trim();
                    if (!raw) continue;

                    let event;
                    try { event = JSON.parse(raw); } catch { continue; }

                    if (event.type === 'connected') {
                        // SSE pipe confirmed open — no-op, just waiting for LLM
                    } else if (event.type === 'content') {
                        // Remove typing indicator on first content
                        if (!agentBubble) {
                            removeTypingIndicator();
                            agentBubble = appendMessage('agent', '').parentElement.querySelector('.message-bubble');
                        }
                        fullResponse += event.content;
                        // Show streaming text (we'll clean up gantt blocks at end)
                        agentBubble.textContent = fullResponse
                            .replace(/```gantt-json[\s\S]*?```/g, '[Generating plan...]')
                            .replace(/```gantt-json[\s\S]*/g, '[Generating plan...]'); // partial block
                        scrollToBottom();
                    } else if (event.type === 'end') {
                        // Stream complete — process final response
                        const { displayText, ganttData } = processAgentResponse(fullResponse);
                        if (agentBubble) agentBubble.textContent = displayText;

                        if (ganttData) {
                            pendingGanttData = ganttData;
                            showLoadProjectButton();
                        }
                        scrollToBottom();
                    } else if (event.type === 'error') {
                        removeTypingIndicator();
                        appendMessage('agent', `Error: ${event.message}`);
                    }
                }
            }
        } catch (err) {
            removeTypingIndicator();
            appendMessage('agent', `Connection error: ${err.message}`);
        } finally {
            removeTypingIndicator(); // safety net if stream closed without 'end' event
            isStreaming = false;
            setInputEnabled(true);
            inputEl().focus();
        }
    }

    // ── Load Project button ──────────────────────────────────────────────────

    function showLoadProjectButton() {
        loadProjectArea().style.display = 'block';
    }

    function hideLoadProjectButton() {
        loadProjectArea().style.display = 'none';
    }

    function getAndClearPendingData() {
        const data = pendingGanttData;
        pendingGanttData = null;
        return data;
    }

    // ── Input handling ───────────────────────────────────────────────────────

    function setInputEnabled(enabled) {
        inputEl().disabled = !enabled;
        sendBtn().disabled = !enabled;
    }

    function autoResizeInput() {
        const el = inputEl();
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }

    // ── Init ─────────────────────────────────────────────────────────────────

    function init() {
        const input = inputEl();
        const btn = sendBtn();

        btn.addEventListener('click', () => {
            const msg = input.value.trim();
            if (!msg) return;
            input.value = '';
            autoResizeInput();
            sendMessage(msg);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                btn.click();
            }
        });

        input.addEventListener('input', autoResizeInput);

        // Show a static welcome message — no API call needed on open
        appendMessage(
            'agent',
            "Hi! I'm your project planning assistant. Tell me about the project you'd like to plan — what it is, roughly how long you have, and what the main deliverables are. I'll ask a few clarifying questions and then generate a detailed Gantt chart for you."
        );
        inputEl().focus();
    }

    return { init, getAndClearPendingData, hideLoadProjectButton };
})();

window.ChatManager = ChatManager;
