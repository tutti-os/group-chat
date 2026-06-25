const CODEX_DESKTOP_AMBIENT_ENV_KEYS = new Set([
  "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
  "CODEX_SHELL",
  "CODEX_THREAD_ID",
]);

export function buildLocalAgentProcessEnv(
  source: NodeJS.ProcessEnv,
  overrides?: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (CODEX_DESKTOP_AMBIENT_ENV_KEYS.has(key)) continue;
    if (typeof value === "string") env[key] = value;
  }
  const merged = {
    ...env,
    ...overrides,
  };
  for (const key of CODEX_DESKTOP_AMBIENT_ENV_KEYS) {
    delete merged[key];
  }
  return merged;
}
