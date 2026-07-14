import type { LocalAgentTargetStatusResponse, RuntimeProfile } from "@group-chat/shared";
import type { DetectContext } from "@tutti-os/agent-acp-kit";
import { LocalAgentRuntimeProvider } from "./local-agent-provider.js";
import type { RuntimeProvider } from "./runtime-provider.js";
import { ServerDemoRuntimeProvider } from "./server-demo-provider.js";

export class RuntimeProviderRegistry {
  constructor(private readonly providers: RuntimeProvider[]) {}

  getProvider(runtimeProfile: RuntimeProfile | null) {
    return this.providers.find((provider) => provider.canHandle(runtimeProfile)) ?? this.providers[0]!;
  }

  async listLocalAgentTargets(detectContext?: DetectContext): Promise<LocalAgentTargetStatusResponse> {
    const provider = this.providers.find((item) => typeof item.listLocalAgentTargets === "function");
    return provider?.listLocalAgentTargets?.(detectContext) ?? { defaultAgentTargetId: "", agents: [] };
  }
}

export function createRuntimeProviderRegistry() {
  return new RuntimeProviderRegistry([new ServerDemoRuntimeProvider(), new LocalAgentRuntimeProvider()]);
}
