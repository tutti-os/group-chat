import type { Artifact, Message, MessageBlock } from "@group-chat/shared";

export function collectImageFileArtifactsForMessages(
  messages: Message[],
  blocks: MessageBlock[],
  artifacts: Artifact[],
): Artifact[] {
  const messageIds = new Set(messages.map((message) => message.id));
  const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const seen = new Set<string>();
  const result: Artifact[] = [];
  for (const block of blocks) {
    if (!messageIds.has(block.messageId)) continue;
    if (block.type !== "image" && block.type !== "file") continue;
    const artifactId = typeof block.metadata?.artifactId === "string" ? block.metadata.artifactId : null;
    if (!artifactId || seen.has(artifactId)) continue;
    const artifact = artifactsById.get(artifactId);
    if (!artifact) continue;
    seen.add(artifactId);
    result.push(artifact);
  }
  return result;
}

export function resolveArtifactsByIds(artifactIds: string[], artifacts: Artifact[]) {
  const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const seen = new Set<string>();
  const result: Artifact[] = [];
  for (const artifactId of artifactIds) {
    if (seen.has(artifactId)) continue;
    const artifact = artifactsById.get(artifactId);
    if (!artifact) continue;
    seen.add(artifactId);
    result.push(artifact);
  }
  return result;
}
