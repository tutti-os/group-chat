# Group Chat Tutti Local Debug App

This directory is the Tutti Load unpacked wrapper for the source project at `../..`.

Generated contract files live here:

- `tutti.app.json`: local debug manifest loaded by App Center.
- `bootstrap.sh`: runtime entrypoint. It must read `TUTTI_APP_HOST` and `TUTTI_APP_PORT` from the Tutti host and must not hard-code a port.
- `run-local-debug.mjs`: launches the existing source project with the Tutti managed Node runtime.
- `icon.svg`: package-local manifest icon.

Runtime behavior:

- Tutti starts `bootstrap.sh` with no arguments.
- `bootstrap.sh` exits if `TUTTI_APP_PORT` is missing and defaults `TUTTI_APP_HOST` to `127.0.0.1` only when the host did not inject one.
- `run-local-debug.mjs` builds `packages/shared`, builds `apps/web`, then starts `apps/server` through `tsx watch src/main.ts`.
- The server binds `HOST=$TUTTI_APP_HOST` and `PORT=$TUTTI_APP_PORT`, serves `apps/web/dist`, and exposes `/api/health`.
- Durable Group Chat data is stored under `TUTTI_APP_DATA_DIR` through `GROUP_CHAT_HOME`.
- Runtime scratch data uses `TUTTI_APP_RUNTIME_DIR` when provided.

Development workflow:

- Server-side edits hot-reload through `tsx watch`.
- Frontend edits require a runtime restart or App Center Reload so the static web build is regenerated.
- Edits to files in `.tutti/dev-app/` require App Center Reload because Tutti must reread the manifest and restart the runtime.
- Load either the project root or `.tutti/dev-app/` from App Center's Load unpacked flow.

Do not copy the source tree into this directory. Keep release packaging separate from this local debug wrapper.
