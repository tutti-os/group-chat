import { resolveMentionTargetReferenceScope, type MentionTarget } from "@group-chat/shared";
import {
  buildAgentGuiDraftPrompt,
  type AgentGuiDraftPromptContext,
} from "./agent-gui-draft-prompt.js";
import { resolveAgentGuiProviderFromAppId } from "./agent-launcher-mentions.js";
import { isTuttiWorkspaceAppEnvironment } from "./tutti-bridge.js";

export type TuttiAgentGuiProvider = "claude-code" | "codex";

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
    if (resolveMentionTargetReferenceScope(mention)?.groupChatLocalAgentMention === "true") continue;
    const provider = resolveAgentGuiProviderFromAppId(mention.referenceEntityId);
    if (!provider) continue;
    const prompt = buildAgentGuiDraftPrompt(stripQuotePrefix(content), mentions, context);
    if (!prompt) continue;
    return { provider, prompt };
  }

  return null;
}

export async function openAgentGuiProvider(
  provider: TuttiAgentGuiProvider,
  draftPrompt?: string,
): Promise<boolean> {
  if (!isTuttiWorkspaceAppEnvironment()) return false;
  const bridge = window.tuttiExternal?.workspace;
  if (!bridge?.openFeature) return false;

  try {
    await bridge.openFeature({
      feature: "agent-chat",
      provider,
      ...(draftPrompt?.trim() ? { draftPrompt: draftPrompt.trim() } : {}),
      autoSubmit: false,
    });
    return true;
  } catch {
    return false;
  }
}

export async function dispatchAgentGuiTask(request: AgentGuiDispatchRequest): Promise<boolean> {
  return openAgentGuiProvider(request.provider, request.prompt);
}
