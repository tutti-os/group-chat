import { sanitizeMentionTargetsForAgentContext, type MentionTarget } from "@group-chat/shared";

export function acpPromptFromLocalAgentInput(input: {
  protocolVersion: string;
  workspaceRoot: string;
  conversation: { id: string; type: string; title: string; collaborationRules?: string; collaborationRulesVersion?: number };
  participant: { id: string; displayName: string; listenMode?: string };
  turn: {
    userMessage: { id: string; senderName: string | null; content: string; mentions: MentionTarget[] };
    attachments: unknown[];
    intent?: {
      requestText: string;
      instruction: string;
      workspaceApps: Array<{ appId: string; label: string; scope?: Readonly<Record<string, string>> }>;
    };
  };
  tools: { contextUrl: string; artifactUrlTemplate?: string; sendMessageUrl: string; saveArtifactUrl: string };
}, options: { compact?: boolean } = {}) {
  if (options.compact) return compactAcpPromptFromLocalAgentInput(input);

  const contextLines = [
    `protocol: ${input.protocolVersion}`,
    `conversation: ${input.conversation.id}`,
    `type: ${input.conversation.type}`,
    `title: ${input.conversation.title}`,
    `agent_participant_id: ${input.participant.id}`,
    `agent_display_name: ${input.participant.displayName}`,
    input.participant.listenMode ? `listen_mode: ${input.participant.listenMode}` : null,
    input.conversation.collaborationRulesVersion ? `collaboration_rules_version: ${input.conversation.collaborationRulesVersion}` : null,
  ].filter(Boolean);
  const collaborationRules = input.conversation.collaborationRules?.trim()
    ? `\n<collaboration_rules>\n${input.conversation.collaborationRules.trim()}\n</collaboration_rules>\n`
    : "";
  const intent = input.turn.intent
    ? `\n<intent>\n${input.turn.intent.instruction}\nrequest_text: ${input.turn.intent.requestText}\nworkspace_apps: ${JSON.stringify(input.turn.intent.workspaceApps)}\n</intent>\n`
    : "";
  const mentions = sanitizeMentionTargetsForAgentContext(input.turn.userMessage.mentions);
  return `<im_context>
${contextLines.join("\n")}
</im_context>
${collaborationRules}
${intent}
<message sender="${escapeAttribute(input.turn.userMessage.senderName ?? "user")}" message_id="${escapeAttribute(input.turn.userMessage.id)}">
${input.turn.userMessage.content}
</message>

<mentions>${JSON.stringify(mentions)}</mentions>
<attachments>${JSON.stringify(input.turn.attachments)}</attachments>
<tool_gateway>
context: ${input.tools.contextUrl}
artifact: ${input.tools.artifactUrlTemplate ?? "use MCP tool group_chat_get_artifact"}
send_message: ${input.tools.sendMessageUrl}
save_artifact: ${input.tools.saveArtifactUrl}
</tool_gateway>

Your intermediate planning, checks, and progress narration are shown in the thinking/process panel. Keep the final reply concise when the user did not request a specific length, format, or level of detail. If the user asks for a target length such as 500字左右, or asks for a detailed/full answer, honor that request even when the reply is longer.
Do not use send_message to repeat the same reply; use it only for an extra side message.
When using a skill, do not include the skill's file path, README, SKILL.md contents, setup notes, or internal instructions in your reply. Only report the user-facing result, concise progress, or a brief blocker.
When the user asks you to create or provide a file, image, video, or other generated asset, create it in the local workspace or save it with save_artifact, then include the resulting local filesystem path in your normal final text so the user can open it. Do not call send_message or attach it to the conversation unless the user explicitly asks you to post it to the group.
When the message mentions both you and a workspace app reference, interpret it as: the user wants you to use that referenced app to complete the remaining request. Keep the workspace-app mention as structured context; do not turn the visible app label into a guessed shell command.
When you create or update Tutti workspace resources (issues/tasks, apps, or agent sessions), include clickable markdown links in your final reply, for example [task title](mention://workspace-issue/{issueId}?workspaceId={workspaceId}&topicId={topicId}). Read workspaceId and topicId from <mentions> (referenceInsert.scope).

Reply as ${input.participant.displayName}. If this message does not need your response, output [NO_REPLY] exactly and nothing else.`;
}

function compactAcpPromptFromLocalAgentInput(input: Parameters<typeof acpPromptFromLocalAgentInput>[0]) {
  const contextLines = [
    `protocol: ${input.protocolVersion}`,
    `conversation: ${input.conversation.id}`,
    `type: ${input.conversation.type}`,
    `title: ${input.conversation.title}`,
    `agent_participant_id: ${input.participant.id}`,
    `agent_display_name: ${input.participant.displayName}`,
    input.participant.listenMode ? `listen_mode: ${input.participant.listenMode}` : null,
  ].filter(Boolean);
  const mentions = sanitizeMentionTargetsForAgentContext(input.turn.userMessage.mentions);
  const intent = input.turn.intent
    ? `\n<intent>${input.turn.intent.instruction}</intent>\n`
    : "";
  return `<im_context>
${contextLines.join("\n")}
</im_context>
${intent}
<message sender="${escapeAttribute(input.turn.userMessage.senderName ?? "user")}" message_id="${escapeAttribute(input.turn.userMessage.id)}">
${input.turn.userMessage.content}
</message>

<mentions>${JSON.stringify(mentions)}</mentions>
<attachments>${JSON.stringify(input.turn.attachments)}</attachments>

Reply as ${input.participant.displayName}. If this message does not need your response, output [NO_REPLY] exactly and nothing else. Keep the answer concise unless the user requested a specific length.`;
}

function escapeAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
