import { expect, test } from "@playwright/test";

test("preserves message cards and attachments through copy, paste, send, and navigation", async ({ context, page, request }) => {
  const sourceBundle = await (await request.post("/api/rooms", { data: { title: "Element Source Room" } })).json();
  const targetBundle = await (await request.post("/api/rooms", { data: { title: "Element Target Room" } })).json();

  const uploaded = await (await request.post(`/api/conversations/${sourceBundle.conversation.id}/artifacts`, {
    data: {
      filename: "element-brief.txt",
      mimeType: "text/plain",
      dataBase64: Buffer.from("preserve this attachment", "utf8").toString("base64"),
    },
  })).json();
  const sourceMessageResult = await (await request.post(`/api/conversations/${sourceBundle.conversation.id}/messages`, {
    data: {
      content: "Source text must remain visible beside its attachment.",
      artifactIds: [uploaded.artifact.id],
      mentions: [],
    },
  })).json();
  await request.post(`/api/conversations/${targetBundle.conversation.id}/messages`, {
    data: {
      content: `group-chat://message/${sourceMessageResult.message.id}`,
      mentions: [],
    },
  });

  await page.goto("/");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });

  const targetRoomButton = page.getByRole("button", { name: /Element Target Room/ });
  const sourceRoomButton = page.getByRole("button", { name: /Element Source Room/ });
  await targetRoomButton.click();
  const linkedCardMessage = page.getByRole("article").filter({ hasText: "Source text must remain visible" });
  await expect(linkedCardMessage).toContainText("element-brief.txt");

  await sourceRoomButton.click();
  const sourceMessage = page.getByRole("article").filter({ hasText: "Source text must remain visible" });
  await sourceMessage.hover();
  await sourceMessage.getByRole("button", { name: /更多|More/ }).click();
  await page.getByRole("menuitem", { name: /多选|Select/ }).click();
  await page.getByRole("toolbar").getByRole("button", { name: /^(复制|Copy)$/ }).click();

  await targetRoomButton.click();
  const composer = page.getByRole("textbox", { name: /消息输入框|Message input/ });
  await composer.click();
  await page.keyboard.press("Meta+V");
  await expect(page.getByRole("button", { name: /Preview element-brief\.txt/ })).toBeVisible();
  await expect(composer).toContainText("Source text must remain visible beside its attachment.");

  const copiedSendResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && response.url().endsWith(`/api/conversations/${targetBundle.conversation.id}/messages`),
  );
  await page.getByLabel(/发送消息|Send message/).click();
  const copiedMessageResult = await (await copiedSendResponse).json();

  const snapshot = await (await request.get("/api/bootstrap")).json();
  const originalArtifact = snapshot.artifacts.find((artifact: { id: string }) => artifact.id === uploaded.artifact.id);
  const copiedBlock = snapshot.messageBlocks.find((block: { messageId: string; type: string }) =>
    block.messageId === copiedMessageResult.message.id && block.type === "file",
  );
  const copiedArtifact = snapshot.artifacts.find((artifact: { id: string }) => artifact.id === copiedBlock?.metadata?.artifactId);
  expect(originalArtifact.messageId).toBe(sourceMessageResult.message.id);
  expect(copiedArtifact.conversationId).toBe(targetBundle.conversation.id);
  expect(copiedArtifact.roomId).toBe(targetBundle.room.id);

  await composer.click();
  await page.evaluate((messageId) => {
    const editor = document.querySelector('[role="textbox"]');
    if (!editor) throw new Error("composer missing");
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", `group-chat://message/${messageId}`);
    editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, sourceMessageResult.message.id);
  const composerMessageCard = composer.locator("[data-message-link-id]");
  await expect(composerMessageCard).toBeVisible();
  await composerMessageCard.click();
  await expect(sourceMessage).toBeVisible();
});
