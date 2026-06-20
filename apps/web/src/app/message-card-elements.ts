import type { Message, MessageBlock } from "@group-chat/shared";

export function resolveLinkedMessagePreviewBlocks(
  message: Message,
  textBlocks: MessageBlock[],
  artifactBlocks: MessageBlock[],
  emptyLabel: string,
) {
  const meaningfulTextBlocks = textBlocks.filter((block) => block.content.trim());
  const blocks = [...meaningfulTextBlocks, ...artifactBlocks]
    .sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt));
  if (blocks.length) return blocks;

  return [{
    id: `${message.id}-link-preview`,
    messageId: message.id,
    type: "main_text" as const,
    content: message.content || emptyLabel,
    status: "success" as const,
    metadata: null,
    sortOrder: 0,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  }];
}
