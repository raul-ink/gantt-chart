/**
 * app.js — Application orchestration
 *
 * Wires together:
 *  - Chat panel open/close
 *  - Chat ↔ Gantt integration (Load Project button)
 */

(function () {
    // ── DOM refs ─────────────────────────────────────────────────────────────
    const chatPanel = document.getElementById('chat-panel');
    const chatOverlay = document.getElementById('chat-overlay');
    const chatToggleBtn = document.getElementById('chat-toggle-btn');
    const chatCloseBtn = document.getElementById('chat-close-btn');
    const emptyChatBtn = document.getElementById('empty-chat-btn');
    const btnLoadProject = document.getElementById('btn-load-project');

    let chatInitialized = false;

    // ── Chat panel toggle ────────────────────────────────────────────────────

    function openChat() {
        chatPanel.classList.add('open');
        chatPanel.setAttribute('aria-hidden', 'false');
        chatOverlay.classList.add('visible');

        if (!chatInitialized) {
            chatInitialized = true;
            ChatManager.init();
        }
    }

    function closeChat() {
        chatPanel.classList.remove('open');
        chatPanel.setAttribute('aria-hidden', 'true');
        chatOverlay.classList.remove('visible');
    }

    chatToggleBtn.addEventListener('click', openChat);
    emptyChatBtn.addEventListener('click', openChat);
    chatCloseBtn.addEventListener('click', closeChat);
    chatOverlay.addEventListener('click', closeChat);

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && chatPanel.classList.contains('open')) {
            closeChat();
        }
    });

    // ── Load Project ─────────────────────────────────────────────────────────

    btnLoadProject.addEventListener('click', () => {
        const data = ChatManager.getAndClearPendingData();
        if (!data) return;

        // Hide the button after loading
        ChatManager.hideLoadProjectButton();

        // Close the chat panel so the user can see the chart
        closeChat();

        // Render the Gantt chart
        loadGanttProject(data);
    });
})();
