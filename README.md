# Group Chat

<p align="center">
  <strong>Local-first group chat for working with AI agents as a team.</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a>
  ·
  <a href="#local-agent-runtime">Local Agents</a>
  ·
  <a href="#development">Development</a>
  ·
  <a href="./LICENSE">License</a>
</p>

<p align="center">
  <a href="./LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue" /></a>
  <img alt="Local-first storage" src="https://img.shields.io/badge/local--first-filesystem%20%2B%20SQLite-111827" />
  <img alt="Local agent routes" src="https://img.shields.io/badge/local--agent-Codex%20%7C%20Claude%20Code-7c3aed" />
  <img alt="Web stack" src="https://img.shields.io/badge/web-React%20%2B%20Vite-0f766e" />
  <img alt="Server stack" src="https://img.shields.io/badge/server-Fastify-000000" />
</p>

Group Chat is a local-first AI chat room app for coordinating multiple AI participants in one shared conversation.

It combines persistent rooms, reusable AI identities, configurable reply policies, local agent runtimes, file attachments, room file references, and live run inspection in a single-user web app. Durable app data stays on your machine, while Codex and Claude Code can be used through their locally installed and authenticated CLIs.

## Features

- Multi-agent rooms: create chat rooms, add AI participants, and manage per-room aliases and instructions.
- Reusable team members: define AI identities once, then add them to different rooms as participants.
- Directed replies: mention one participant, use `@all`, or choose manual responders for a turn.
- Local agent routes: connect installed Codex and Claude Code CLIs without putting API keys into the app.
- File-aware conversations: attach files, preview uploads, browse room files, and re-reference existing room files.
- Run visibility: inspect active agent runs, message blocks, reasoning/tool events, status, cancellation, and errors.
- Local-first storage: keep the database, identities, rooms, uploads, artifacts, previews, and run state under a local app home.
- Tutti workspace packaging: build a distributable Tutti app package for the same local-first group chat experience.

## Quick Start

Requirements:

- Node.js 22.5 or newer, with `node:sqlite` available
- pnpm 10.11.0, preferably through Corepack

```bash
corepack enable
pnpm install
pnpm dev
```

Then open the Vite web URL printed by the dev server. By default:

- web: `http://127.0.0.1:5173`
- server: `http://127.0.0.1:8788`

The root `pnpm dev` command builds the shared package, starts the Fastify server, and starts the React/Vite web app. The Vite dev server proxies `/api`, WebSocket traffic, and `/local-assets` to the local server.

## Single-Service Mode

For a production-like local run, build the web app and let the server host the static output:

```bash
pnpm --filter @group-chat/web build
GROUP_CHAT_WEB_DIST="$(pwd)/apps/web/dist" pnpm --filter @group-chat/server dev
```

Open `http://127.0.0.1:8788/`.

The server serves the static web app, `/api/*`, WebSocket traffic, and `/local-assets/*` from one process.

## Local Agent Runtime

Group Chat currently seeds two local-agent runtime profiles:

- `local-agent:codex` for Codex CLI
- `local-agent:claude` for Claude Code CLI

Install and authenticate the CLI you want to use before starting real local-agent turns. You can check provider detection without launching a real turn:

```bash
pnpm --filter @group-chat/server local-agent:smoke -- --provider codex --detect-only
pnpm --filter @group-chat/server local-agent:smoke -- --provider claude --detect-only
```

To run an isolated end-to-end turn against a real local CLI:

```bash
pnpm --filter @group-chat/server local-agent:smoke -- --provider codex
pnpm --filter @group-chat/server local-agent:smoke -- --provider claude
```

Useful runtime variables:

```env
PORT=8788
HOST=127.0.0.1
GROUP_CHAT_HOME=~/.group-chat
GROUP_CHAT_WEB_DIST=
GROUP_CHAT_SERVER_URL=http://127.0.0.1:8788
GROUP_CHAT_LOCAL_AGENT_TIMEOUT_MS=120000
GROUP_CHAT_LOCAL_AGENT_COMMAND=
GROUP_CHAT_LOCAL_AGENT_codex_COMMAND=
GROUP_CHAT_LOCAL_AGENT_claude_COMMAND=
```

## Local Data

The app reads durable data from `GROUP_CHAT_HOME`. The default depends on how it is started:

- Local server/dev mode: if `GROUP_CHAT_HOME` is not set, the server uses `~/.group-chat`.
- Tutti app mode: `bootstrap.sh` sets `GROUP_CHAT_HOME` to `TUTTI_APP_DATA_DIR`, falling back to the packaged app's `.data` directory if Tutti does not provide one.

Under `GROUP_CHAT_HOME`, data is organized as:

- SQLite database: `data/group-chat.db`
- identity workspaces: `identities/`
- room uploads, artifacts, previews, and participant workspaces: `rooms/`
- run state: `runs/`

Set `GROUP_CHAT_HOME` to move durable app data elsewhere when running the server directly. In Tutti mode, prefer letting the base provide `TUTTI_APP_DATA_DIR`. The e2e suite uses an isolated `.group-chat/e2e` directory inside the repository.

## Workspace Layout

```text
apps/
  web/       React/Vite frontend
  server/    Fastify API, WebSocket, local store, files, and agent runtimes
packages/
  shared/    Shared contracts, domain types, and DTOs
scripts/     Smoke orchestration and Tutti app packaging helpers
tests/       Node test coverage for package workflows
docs/        Architecture notes, domain model notes, and implementation plans
```

## Tutti App Package

Build a Tutti workspace app package with:

```bash
pnpm package:tutti
```

The packaging script builds the web app, bundles the server, writes the Tutti manifest and bootstrap files, and maps Tutti runtime variables into Group Chat environment variables.

## Development

Useful commands:

```bash
pnpm build
pnpm check
pnpm test
pnpm smoke
pnpm smoke:real-local-agents
pnpm e2e
```

Run the core IM flow smoke with the in-process demo runtime:

```bash
pnpm --filter @group-chat/server core:smoke
```

This covers room creation, room settings updates, reply policy, identities, participants, structured mentions, file attachment blocks, room file re-reference semantics, active run cancellation, participant removal, and room deletion through public HTTP APIs.

Run the local workspace materialization smoke:

```bash
pnpm --filter @group-chat/server workspace:smoke
```

This verifies identity workspace files, participant room workspace files, room instructions, raw conversation logs, distilled context, and local-user memory generated after a demo agent reply.

Run the browser UI flow smoke:

```bash
pnpm e2e
```

This builds the web app, starts a temporary server with an isolated `.group-chat/e2e` home, then verifies the browser flow for creating team members, adding local-agent members, inspecting runtime settings, creating and editing rooms, searching rooms, managing members, selecting responders, inspecting run status, attaching and reusing files, sending messages, receiving a demo agent reply, and deleting the room.

## License

Group Chat is licensed under the [Apache License 2.0](./LICENSE).
