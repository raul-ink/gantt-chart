import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { TLLMEvent } from '@smythos/sdk';
import { agent } from './agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory chat sessions map
const chatSessions = new Map<string, ReturnType<typeof agent.chat>>();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// POST /api/chat — send a message, receive SSE response
app.post('/api/chat', async (req, res) => {
    const { sessionId, message } = req.body as { sessionId: string; message: string };

    if (!sessionId || !message) {
        res.status(400).json({ error: 'sessionId and message are required' });
        return;
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    const sendEvent = (data: object) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Immediately confirm the SSE pipe is open
    sendEvent({ type: 'connected' });

    // 30-second timeout guard
    const timeout = setTimeout(() => {
        console.error('[chat] LLM timeout — check vault credentials at .smyth/.sre/vault.json');
        sendEvent({ type: 'error', message: 'The AI did not respond in time. Please check that your API key is configured in .smyth/.sre/vault.json (or ~/.smyth/.sre/vault.json).' });
        res.end();
    }, 30_000);

    // Get or create chat session
    if (!chatSessions.has(sessionId)) {
        chatSessions.set(sessionId, agent.chat({ id: sessionId, persist: false }));
    }

    const chat = chatSessions.get(sessionId)!;

    console.log(`[chat] ${sessionId.slice(0, 8)} → "${message.slice(0, 60)}"`);

    try {
        const stream = await chat.prompt(message).stream();

        stream.on(TLLMEvent.Content, (content: string) => {
            sendEvent({ type: 'content', content });
        });

        stream.on(TLLMEvent.End, () => {
            clearTimeout(timeout);
            console.log(`[chat] ${sessionId.slice(0, 8)} stream ended`);
            sendEvent({ type: 'end' });
            res.end();
        });

        stream.on(TLLMEvent.Error, (err: string) => {
            clearTimeout(timeout);
            console.error(`[chat] ${sessionId.slice(0, 8)} stream error:`, err);
            sendEvent({ type: 'error', message: err });
            res.end();
        });
    } catch (err) {
        clearTimeout(timeout);
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[chat] ${sessionId.slice(0, 8)} error:`, errMsg);
        sendEvent({ type: 'error', message: errMsg });
        res.end();

      }
});

// DELETE /api/chat/:sessionId — clear a session
app.delete('/api/chat/:sessionId', (req, res) => {
    chatSessions.delete(req.params.sessionId);
    res.json({ ok: true });
});

// Serve index.html for any other route (SPA fallback)
app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Gantt Chart app running at http://localhost:${PORT}`);
});
