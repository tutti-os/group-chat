import type { Artifact } from "@group-chat/shared";
import { buildAgentInstructions, buildEffectiveRoleDescription } from "../domains/agent-instructions.js";
import type { RuntimeProvider, RuntimeReplyContext } from "./runtime-provider.js";

const STREAM_DELAY_MS = 80;

export class ServerDemoRuntimeProvider implements RuntimeProvider {
  id = "server-demo";

  canHandle(runtimeProfile: RuntimeReplyContext["runtimeProfile"]) {
    return !runtimeProfile || runtimeProfile.kind === "server-demo";
  }

  describeRun(context: RuntimeReplyContext) {
    return {
      runtime: context.runtimeProfile?.kind ?? "server-demo",
      provider: context.runtimeProfile?.provider ?? "group-chat",
      model: context.runtimeProfile?.model ?? context.participant.runtimeProfileId ?? "demo",
    };
  }

  async detect() {
    return { available: true };
  }

  async *streamReply(context: RuntimeReplyContext) {
    const response = buildDemoResponse(context);
    for (const token of splitForStreaming(response)) {
      yield token;
      await delay(STREAM_DELAY_MS);
    }
  }

  async cancel() {
    return { cancelled: false, reason: "server-demo replies complete in-process" };
  }
}

function buildDemoResponse(context: RuntimeReplyContext) {
  const instructions = buildAgentInstructions({
    conversation: context.conversation,
    participant: context.participant,
    identity: context.identity,
  });
  const instructionMode = instructions.startsWith("# Agent Instructions") ? "AGENTS.md 风格指令" : "运行指令";
  const roleDescription = buildEffectiveRoleDescription(context.participant, context.identity);
  const identityHint = context.identity
    ? `我的${instructionMode}包含「${context.identity.name}」角色描述：${roleDescription || "未配置"}`
    : "我还没有绑定角色设定。";
  const trimmed = context.userMessage.content.trim();
  if (/(?:无需回复|不用回复|别回复|不要回复|\bno reply\b)/i.test(trimmed)) return "[NO_REPLY]";
  const attachmentContext = formatAttachmentContext(context.attachments);
  const attachmentHint = attachmentContext
    ? ` 我还收到了结构化附件上下文，会作为 <attachments> metadata 注入 agent 输入：${attachmentContext}`
    : "";
  if (!trimmed) {
    return `${context.participant.displayName}: 我看到了这些附件。${identityHint}${attachmentHint} 当前 demo 已生成 AGENTS.md 风格指令，后续接真实 agent 时可直接注入。`;
  }
  if (context.participant.displayName.toLowerCase().includes("critic")) {
    return `我从评审角度看：${trimmed}。${identityHint}${attachmentHint} 这里需要确认目标、约束和验收方式；如果是方案讨论，我会优先指出风险和缺口。`;
  }
  return `我从规划角度看：${trimmed}。${identityHint}${attachmentHint} 可以先拆成上下文、决策、执行步骤和验证闭环，再让不同参与者分别补充。`;
}

function formatAttachmentContext(attachments: Artifact[]) {
  if (attachments.length === 0) return "";
  const items = attachments
    .map((artifact, index) => {
      const preview = artifact.textPreview ? ` preview="${escapeAttribute(truncate(artifact.textPreview, 240))}"` : "";
      return `<attachment index="${index + 1}" artifact_id="${escapeAttribute(artifact.id)}" name="${escapeAttribute(
        artifact.filename,
      )}" mime_type="${escapeAttribute(artifact.mimeType)}" size_bytes="${artifact.sizeBytes}" local_path="${escapeAttribute(
        artifact.localPath,
      )}" public_url="${escapeAttribute(artifact.publicUrl)}"${preview} />`;
    })
    .join(" ");
  return `<attachments>${items}</attachments>`;
}

function truncate(text: string, maxLength: number) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

function escapeAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function splitForStreaming(text: string) {
  const parts = text.match(/.{1,4}/gu);
  return parts ?? [text];
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
