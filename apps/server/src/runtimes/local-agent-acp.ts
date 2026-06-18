export function acpPromptFromLocalAgentInput(input: {
  protocolVersion: string;
  workspaceRoot: string;
  conversation: { id: string; type: string; title: string; collaborationRules?: string; collaborationRulesVersion?: number };
  participant: { id: string; displayName: string; listenMode?: string };
  turn: { userMessage: { id: string; senderName: string | null; content: string; mentions: unknown[] }; attachments: unknown[] };
  tools: { contextUrl: string; artifactUrlTemplate?: string; sendMessageUrl: string; saveArtifactUrl: string };
}) {
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
  return `<im_context>
${contextLines.join("\n")}
</im_context>
${collaborationRules}
<message sender="${escapeAttribute(input.turn.userMessage.senderName ?? "user")}" message_id="${escapeAttribute(input.turn.userMessage.id)}">
${input.turn.userMessage.content}
</message>

<mentions>${JSON.stringify(input.turn.userMessage.mentions)}</mentions>
<attachments>${JSON.stringify(input.turn.attachments)}</attachments>
<tool_gateway>
context: ${input.tools.contextUrl}
artifact: ${input.tools.artifactUrlTemplate ?? "use MCP tool group_chat_get_artifact"}
send_message: ${input.tools.sendMessageUrl}
save_artifact: ${input.tools.saveArtifactUrl}
</tool_gateway>

Your normal text output is automatically streamed as your reply in this IM conversation.
Do not use send_message to repeat the same reply; use it only for an extra side message.
When the user asks you to create or provide a file, image, video, or other generated asset, create it in the local workspace or save it with save_artifact, then include the resulting local filesystem path in your normal final text so the user can open it. Do not call send_message or attach it to the conversation unless the user explicitly asks you to post it to the group.
When you create or update Tutti workspace resources (issues/tasks, apps, or agent sessions), include clickable markdown links in your final reply, for example [task title](mention://workspace-issue/{issueId}?workspaceId={workspaceId}&topicId={topicId}). Read workspaceId and topicId from <mentions> (referenceInsert.scope).

Reply as ${input.participant.displayName}. If this message does not need your response, output [NO_REPLY] exactly and nothing else.`;
}

function escapeAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
