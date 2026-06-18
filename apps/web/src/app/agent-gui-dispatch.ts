import type { MentionTarget } from "@group-chat/shared";
import {
  buildAgentGuiDraftPrompt,
  type AgentGuiDraftPromptContext,
} from "./agent-gui-draft-prompt.js";
import { isTuttiWorkspaceAppEnvironment } from "./tutti-bridge.js";

export type TuttiAgentGuiProvider = "claude-code" | "codex";

const AGENT_LAUNCHER_APP_IDS: Record<string, TuttiAgentGuiProvider> = {
  "agent-claude-code": "claude-code",
  "agent-codex": "codex",
};

export interface AgentGuiDispatchRequest {
  provider: TuttiAgentGuiProvider;
  prompt: string;
}

export type { AgentGuiDraftPromptContext };

function stripQuotePrefix(content: string): string {
  return content.replace(/^(?:>.*\n)+>\s*\n*/m, "").trim();
}

export function resolveAgentGuiDispatchFromMentions(
  content: string,
  mentions: MentionTarget[],
  context: AgentGuiDraftPromptContext = {},
): AgentGuiDispatchRequest | null {
  for (const mention of mentions) {
    if (mention.mentionType !== "reference") continue;
    if (mention.referenceProviderId !== "workspace-app") continue;
    const provider = AGENT_LAUNCHER_APP_IDS[mention.referenceEntityId?.trim() ?? ""];
    if (!provider) continue;
    const prompt = buildAgentGuiDraftPrompt(stripQuotePrefix(content), mentions, context);
    if (!prompt) continue;
    return { provider, prompt };
  }

  return null;
}

export async function dispatchAgentGuiTask(request: AgentGuiDispatchRequest): Promise<boolean> {
  if (!isTuttiWorkspaceAppEnvironment()) return false;
  const bridge = window.tuttiExternal?.workspace;
  if (!bridge?.openFeature) return false;

  try {
    await bridge.openFeature({
      feature: "agent-chat",
      provider: request.provider,
      draftPrompt: request.prompt,
      autoSubmit: false,
    });
    return true;
  } catch {
    return false;
  }
}
