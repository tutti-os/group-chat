# Group Chat CLI Commands

Group Chat exposes read-only commands for agents and the Tutti CLI.

CLI output includes public conversation data only. Whisper messages and artifacts linked to whisper messages or runs are omitted; JSON outputs include a `warnings` array describing this policy.

## `group-chat conversations list`

List conversations with room metadata, participant count, pin state, and recent public activity.

Options:

- `--limit <number>`: maximum number of conversations to return. Defaults to 20 and caps at 100.
- `--query <text>`: filters conversation titles, room titles, and descriptions.
- `--pinned`: returns only pinned conversations.

Examples:

```sh
tutti group-chat conversations list
tutti group-chat conversations list --limit 10
tutti group-chat conversations list --query planning --json
tutti group-chat conversations list --pinned
```

## `group-chat conversations get`

Read one conversation with room metadata, participants, recent public messages, and public artifact summaries.

Options:

- `--conversation-id <id>`: conversation id to inspect.
- `--recent-message-limit <number>`: maximum number of recent messages to include. Defaults to 20 and caps at 100.

Examples:

```sh
tutti group-chat conversations get --conversation-id abc123 --json
```

## `group-chat artifacts list`

List public artifacts with conversation, filename, MIME type, size, and creation time.

Options:

- `--conversation-id <id>`: filters artifacts to one conversation.
- `--limit <number>`: maximum number of artifacts to return. Defaults to 20 and caps at 100.
- `--query <text>`: filters artifact id, filename, MIME type, and text preview.
- `--kind <kind>`: filters by artifact kind, such as `upload`, `generated`, `preview`, or `run-output`.

Examples:

```sh
tutti group-chat artifacts list
tutti group-chat artifacts list --conversation-id abc123 --json
tutti group-chat artifacts list --query report
```

## `group-chat artifacts get`

Read one public artifact with local path, public URL, source message/run ids, and text preview.

Options:

- `--artifact-id <id>`: artifact id to inspect.

Examples:

```sh
tutti group-chat artifacts get --artifact-id art123 --json
```
