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

This runs the core IM flow, workspace materialization, and detection of the default Agent from the live Tutti Agent catalog. To include a real local Agent turn:

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

Load the complete Agent catalog and validate its default target without starting a real turn:

```bash
pnpm --filter @group-chat/server local-agent:smoke -- --detect-only
```

Run an isolated end-to-end turn against the catalog default, or select an exact target returned by `GET /api/local-agent/agents`:

```bash
pnpm --filter @group-chat/server local-agent:smoke
pnpm --filter @group-chat/server local-agent:smoke -- --agent-id '<exact-agent-target-id>'
```

The smoke script starts a temporary server with its own `GROUP_CHAT_HOME`, creates a room, adds a local agent participant, sends one message, waits for the assistant message to finish, prints the resulting block types, then cleans up.

## Agent identity contract

Group Chat selects, mentions, persists, resumes, and launches local Agents by the exact `agentTargetId` returned by the live Tutti Agent catalog. `providerId` is retained only as runtime-adapter metadata. Multiple Agent targets may share one provider. Legacy provider-only records are upgraded only when the complete catalog contains exactly one available, runtime-supported target for that provider; otherwise execution fails closed.

The old provider-specific AgentGUI launchers are intentionally hidden. The composer builds its Agent list dynamically from `GET /api/local-agent/agents`, and target-scoped model, reasoning, speed, skill, and session state remain isolated by exact Agent ID.
