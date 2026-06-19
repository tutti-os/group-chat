export interface AgentForwardSection {
  senderKey: string;
  senderLabel: string;
  content: string;
}

export function groupAgentForwardSections(sections: AgentForwardSection[]) {
  const showSender = new Set(sections.map((section) => section.senderKey)).size > 1;
  const groups: AgentForwardSection[] = [];

  for (const section of sections) {
    const previous = groups.at(-1);
    if (previous?.senderKey === section.senderKey) {
      previous.content = joinAgentForwardSentences(previous.content, section.content);
      continue;
    }
    groups.push({ ...section });
  }

  return groups
    .map((group) => showSender ? `${group.senderLabel}: ${group.content}` : group.content)
    .join("\n")
    .trim();
}

function joinAgentForwardSentences(left: string, right: string) {
  const separator = /[。！？.!?；;：:]$/.test(left.trimEnd()) ? "" : "。";
  return `${left.trimEnd()}${separator}${right.trimStart()}`;
}
