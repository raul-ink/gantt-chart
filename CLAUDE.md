# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript (src/server.ts → dist/server.js) via Rollup
npm start            # Run the web server on http://localhost:3000
npm run dev          # Build + start in one step
npm run dbgstart     # Run with source maps enabled
```

## Architecture

This is a **full-stack web application**: an Express server backed by a SmythOS AI agent, serving a browser-based Gantt chart planner.

**Backend (`src/`):**
- `src/agent.ts` — SmythOS `GanttPlanner` agent (`gpt-4o`). Its behavior prompt instructs the LLM to discuss projects with users and output Gantt JSON wrapped in ` ```gantt-json ` code blocks.
- `src/server.ts` — Express server. Serves `public/` as static files. Key route: `POST /api/chat` accepts `{ sessionId, message }` and returns an SSE stream. Chat sessions are held in an in-memory `Map`; `DELETE /api/chat/:sessionId` clears one.

**Frontend (`public/`):**
- `index.html` — Single-page layout: header, empty-state/gantt-area, sliding chat panel.
- `js/gantt.js` — `GanttChart` class renders a split-panel chart: left sticky HTML rows (ID/Name/Start/End/Effort) + right SVG timeline (phase bars, task bars, dependency arrows). `window.loadGanttProject(data)` is the public entry point.
- `js/chat.js` — `ChatManager` module. Sends messages via `fetch()` POST + reads SSE using `ReadableStream`. On stream end, looks for ` ```gantt-json ` blocks in the accumulated response, extracts + parses the JSON, and shows the **Load Project** button. `window.ChatManager` is the public export.
- `js/app.js` — Wires chat panel open/close and the Load Project button → calls `loadGanttProject()`.

**Build:** Rollup + esbuild compiles only `src/server.ts` → `dist/server.js` (ES module). All node_modules are marked external. The `public/` directory is served as-is — no frontend build step.

## Key Patterns

**SSE streaming (server → browser):**
```typescript
// server.ts: SmythOS stream → SSE
import { TLLMEvent } from '@smythos/sdk';

const stream = await chat.prompt(message).stream();
stream.on(TLLMEvent.Content, (content: string) => sendEvent({ type: 'content', content }));
stream.on(TLLMEvent.End, () => { sendEvent({ type: 'end' }); res.end(); });
stream.on(TLLMEvent.Error, (err: string) => { sendEvent({ type: 'error', message: err }); res.end(); });
```
```javascript
// chat.js: reading SSE from a POST response (not EventSource, since it's a POST)
const reader = response.body.getReader();
// parse `data: {...}` lines from the ReadableStream
```

**IMPORTANT — never add a `req.on('close')` / `clientDisconnected` guard** in Express SSE routes.
Express's `json()` middleware fully consumes the POST body before the route handler runs, which can
fire the `'close'` event prematurely — silently dropping all `TLLMEvent.Content` events before they
reach the browser.

**Gantt JSON format:** Agent outputs a structured JSON with `project`, `groups[]`, and each group has `tasks[]`. Task IDs follow `"task-X-Y"` format. The frontend detects the ` ```gantt-json ` fence to extract it.

**Gantt rendering:** Date positions are calculated as `daysBetween(projectStart, date) * DAY_WIDTH` (28px/day). SVG uses a linear gradient (`url(#taskGrad)`) for task bars and `<marker>` for dependency arrowheads.

## Credentials

API keys live in `.smyth/.sre/vault.json` (project-local) or `~/.smyth/.sre/vault.json` (global). The `.env` file only controls `LOG_LEVEL` / `LOG_FILTER`.

## Code Style

- 4-space indentation, single quotes, 150-char line width (`.prettierrc`)
- TypeScript for backend (`src/`); vanilla JS for frontend (`public/js/`)
