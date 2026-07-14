import { isTuttiWorkspaceAppEnvironment } from "./tutti-bridge.js";

export type TuttiAgentGuiProvider = string;

export interface AgentGuiDispatchRequest {
  provider: TuttiAgentGuiProvider;
  prompt: string;
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
