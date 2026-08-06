export interface LocalAgentCommand {
  command: string;
  args: string[];
}

export function resolveLocalAgentCommand(
  providerId: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): LocalAgentCommand | null {
  const provider = providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const providerSpecific = provider ? env[`GROUP_CHAT_LOCAL_AGENT_${provider}_COMMAND`] : undefined;
  const legacyAlias = provider === "CLAUDE_CODE"
    ? env.GROUP_CHAT_LOCAL_AGENT_CLAUDE_COMMAND
    : undefined;
  const configured = (providerSpecific || legacyAlias || env.GROUP_CHAT_LOCAL_AGENT_COMMAND || "").trim();
  if (!configured) return null;

  if (!configured.startsWith("[")) {
    return { command: configured, args: [] };
  }

  let argv: unknown;
  try {
    argv = JSON.parse(configured);
  } catch {
    throw new Error("Configured local Agent command must be an executable path or a JSON argv array.");
  }
  if (
    !Array.isArray(argv)
    || argv.length === 0
    || argv.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new Error("Configured local Agent command JSON must contain non-empty string arguments.");
  }
  return { command: argv[0]!, args: argv.slice(1) };
}
