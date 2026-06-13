# group-chat

Local-first AI chat room app.

## Development

```bash
pnpm install
pnpm dev
```

## Local Agent Smoke

Run the standard smoke suite:

```bash
pnpm smoke
```

This runs the core IM flow, workspace materialization, and local-agent provider detection for Codex and Claude. To include real Codex/Claude turns:

```bash
pnpm smoke:real-local-agents
```

Run the browser UI flow smoke:

```bash
pnpm e2e
```

This builds the web app, starts a temporary server with an isolated `.group-chat/e2e` home, then verifies the browser flow for creating a team member, creating a local-agent member, inspecting runtime settings, creating a room, editing room settings, searching rooms, adding/removing room members, previewing reply targets, selecting manual responders, inspecting run status, selecting an @ mention, attaching/removing a file, browsing room files, re-referencing/removing a room file, sending messages, receiving a demo agent reply, and deleting the room.

Run the core IM flow smoke with the in-process demo runtime:

```bash
pnpm --filter @group-chat/server core:smoke
```

This covers room creation, room settings update, reply policy, identities, participants, structured mentions, file attachment blocks, room file re-reference semantics, active run cancellation, participant removal, and room deletion through public HTTP APIs.

Run the local workspace materialization smoke:

```bash
pnpm --filter @group-chat/server workspace:smoke
```

This verifies identity workspace files, participant room workspace files, room instructions, raw conversation logs, distilled context, and local-user memory generated after a demo agent reply.

Run provider detection without starting a real agent turn:

```bash
pnpm --filter @group-chat/server local-agent:smoke -- --provider codex --detect-only
pnpm --filter @group-chat/server local-agent:smoke -- --provider claude --detect-only
```

Run an isolated end-to-end local-agent turn against the real CLI:

```bash
pnpm --filter @group-chat/server local-agent:smoke -- --provider codex
pnpm --filter @group-chat/server local-agent:smoke -- --provider claude
```

The smoke script starts a temporary server with its own `GROUP_CHAT_HOME`, creates a room, adds a local agent participant, sends one message, waits for the assistant message to finish, prints the resulting block types, then cleans up.
