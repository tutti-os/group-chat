export function resolveLocalAgentCommand(
  providerId: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const provider = providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const providerSpecific = provider ? env[`GROUP_CHAT_LOCAL_AGENT_${provider}_COMMAND`] : undefined;
  const legacyAlias = provider === "CLAUDE_CODE"
    ? env.GROUP_CHAT_LOCAL_AGENT_CLAUDE_COMMAND
    : undefined;
  return providerSpecific || legacyAlias || env.GROUP_CHAT_LOCAL_AGENT_COMMAND || "";
}
