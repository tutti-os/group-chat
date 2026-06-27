import { expect, test } from "@playwright/test";

test("preserves app references and message cards copied from the timeline", async ({ context, page, request }) => {
  const roomBundle = await (await request.post("/api/rooms", { data: { title: "Rich Timeline Copy Room" } })).json();
  const source = await (await request.post(`/api/conversations/${roomBundle.conversation.id}/messages`, {
    data: { content: "Original linked message", mentions: [] },
  })).json();
  await request.post(`/api/conversations/${roomBundle.conversation.id}/messages`, {
    data: {
      content: `[Codex](mention://workspace-app/agent-codex?workspaceId=ws-1) group-chat://message/${source.message.id} group-chat://summary/copied-summary-task`,
      mentions: [{
        participantId: "workspace-app:agent-codex",
        displayNameSnapshot: "Codex",
        mentionType: "reference",
        referenceProviderId: "workspace-app",
        referenceEntityId: "agent-codex",
        referenceInsert: {
          kind: "markdown-link",
          label: "Codex",
          href: "mention://workspace-app/agent-codex?workspaceId=ws-1",
        },
      }],
    },
  });
  await page.goto("/");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  await page.getByRole("button", { name: /Rich Timeline Copy Room/ }).click();
  const richMessage = page.getByRole("article").filter({ hasText: "Original linked message" }).last();
  await richMessage.locator('[data-slot="message-copy-content"]').evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.press("Meta+C");
  const clipboardDebug = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    return Promise.all(items.flatMap((item) => item.types.map(async (type) => ({
      type,
      value: await (await item.getType(type)).text(),
    }))));
  });
  expect(JSON.stringify(clipboardDebug)).toContain("data-group-chat-copy-payload");
  const composer = page.getByRole("textbox", { name: /消息输入框|Message input/ });
  await composer.click();
  await page.keyboard.press("Meta+V");

  await expect(composer.locator('[data-mention-display-mode="agent-launcher"], [data-mention-kind="reference"]')).toBeVisible();
  await expect(composer.locator(`[data-message-link-id*="${source.message.id}"]`)).toBeVisible();
  await expect(composer.locator('[data-summary-link-id="copied-summary-task"]')).toBeVisible();
});

test("pastes selected timeline images and text in their original order", async ({ context, page, request }) => {
  const roomBundle = await (await request.post("/api/rooms", { data: { title: "Timeline Ordered Copy Room" } })).json();
  const imageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const first = await (await request.post(`/api/conversations/${roomBundle.conversation.id}/artifacts`, {
    data: { filename: "ordered-first.png", mimeType: "image/png", dataBase64: imageBase64 },
  })).json();
  const second = await (await request.post(`/api/conversations/${roomBundle.conversation.id}/artifacts`, {
    data: { filename: "ordered-second.png", mimeType: "image/png", dataBase64: imageBase64 },
  })).json();
  await request.post(`/api/conversations/${roomBundle.conversation.id}/messages`, {
    data: {
      content: "甲乙",
      artifactIds: [first.artifact.id, second.artifact.id],
      parts: [
        { type: "artifact", artifactId: first.artifact.id },
        { type: "text", content: "甲" },
        { type: "artifact", artifactId: second.artifact.id },
        { type: "text", content: "乙" },
      ],
      mentions: [],
    },
  });
  await page.goto("/");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  await page.getByRole("button", { name: /Timeline Ordered Copy Room/ }).click();
  const message = page.getByRole("article").filter({ hasText: "甲" });
  await message.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.press("Meta+C");
  const composer = page.getByRole("textbox", { name: /消息输入框|Message input/ });
  await composer.click();
  await page.keyboard.press("Meta+V");

  expect(await composer.evaluate((editor) => {
    const order: string[] = [];
    const visit = (node: Node) => {
      if (node instanceof HTMLElement && node.dataset.uploadItemId) {
        order.push(`image:${node.title}`);
        return;
      }
      if (node instanceof Text) {
        const text = (node.textContent ?? "").replaceAll("\u200b", "").trim();
        if (text) order.push(`text:${text}`);
        return;
      }
      for (const child of node.childNodes) visit(child);
    };
    for (const child of editor.childNodes) visit(child);
    return order;
  })).toEqual(["image:ordered-first.png", "text:甲", "image:ordered-second.png", "text:乙"]);
});

test("sends interleaved composer images and text in visual order", async ({ page, request }) => {
  const roomBundle = await (await request.post("/api/rooms", { data: { title: "Interleaved Message Room" } })).json();
  await page.goto("/");
  await page.getByRole("button", { name: /Interleaved Message Room/ }).click();
  const composer = page.getByRole("textbox", { name: /消息输入框|Message input/ });
  const fileInput = composer.locator("xpath=ancestor::footer").locator('input[type="file"]');
  const imageBuffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await fileInput.setInputFiles({ name: "first.png", mimeType: "image/png", buffer: imageBuffer });
  await page.keyboard.type("第一段");
  await fileInput.setInputFiles({ name: "second.png", mimeType: "image/png", buffer: imageBuffer });
  await page.keyboard.type("第二段");

  const sent = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && response.url().endsWith(`/api/conversations/${roomBundle.conversation.id}/messages`),
  );
  await page.getByLabel(/发送消息|Send message/).click();
  const result = await (await sent).json();
  expect(result.blocks.map((block: { type: string; content: string }) => ({ type: block.type, content: block.content }))).toEqual([
    { type: "image", content: "" },
    { type: "main_text", content: "第一段" },
    { type: "image", content: "" },
    { type: "main_text", content: "第二段" },
  ]);
  const message = page.getByRole("article").filter({ hasText: "第一段" });
  await expect(message).toBeVisible();
  expect(await message.locator('[data-slot="message-copy-content"]').evaluate((content) => {
    const children = [...content.children] as HTMLElement[];
    return children.flatMap((child, index) => {
      const next = children[index + 1];
      if (child.dataset.slot !== "artifact-block" || next?.dataset.slot !== "message-block") return [];
      return [next.getBoundingClientRect().top - child.getBoundingClientRect().bottom];
    });
  })).toEqual([6, 6]);
});

test("copies composer images and files across rooms", async ({ context, page, request }) => {
  await request.post("/api/rooms", { data: { title: "Clipboard Source Room" } });
  await request.post("/api/rooms", { data: { title: "Clipboard Target Room" } });
  await page.goto("/");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  await page.getByRole("button", { name: /Clipboard Source Room/ }).click();
  const composer = page.getByRole("textbox", { name: /消息输入框|Message input/ });
  await composer.locator("xpath=ancestor::footer").locator('input[type="file"]').setInputFiles([
    {
      name: "cross-room.png",
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
    },
    { name: "cross-room.txt", mimeType: "text/plain", buffer: Buffer.from("cross room") },
  ]);
  await expect(composer.locator("[data-upload-item-id]")).toHaveCount(2);
  await composer.click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Meta+C");

  await page.getByRole("button", { name: /Clipboard Target Room/ }).click();
  const targetComposer = page.getByRole("textbox", { name: /消息输入框|Message input/ });
  await targetComposer.click();
  await page.keyboard.press("Meta+V");

  await expect(targetComposer.locator("[data-upload-item-id]")).toHaveCount(2);
  await expect(targetComposer.getByRole("button", { name: /Preview cross-room\.png/ })).toBeVisible();
  await expect(targetComposer.getByRole("button", { name: /Preview cross-room\.txt/ })).toBeVisible();
});

test("copies and pastes composer images as attachments", async ({ context, page }) => {
  await page.goto("/");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  const composer = page.getByRole("textbox", { name: /消息输入框|Message input/ });
  await composer.locator("xpath=ancestor::footer").locator('input[type="file"]').setInputFiles({
    name: "composer-copy.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  const image = composer.locator("[data-upload-item-id]");
  await expect(image).toHaveCount(1);
  await composer.locator("[data-upload-caret-anchor]").evaluate((anchor) => {
    const range = document.createRange();
    range.selectNodeContents(anchor);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.type("复制文字");
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Meta+C");
  await page.keyboard.press("Backspace");
  await expect(composer.locator("[data-upload-item-id]")).toHaveCount(0);
  await page.keyboard.press("Meta+V");

  await expect(composer.locator("[data-upload-item-id]")).toHaveCount(1);
  expect(await composer.evaluate((editor) => {
    const clone = editor.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("[data-upload-item-id]").forEach((node) => node.remove());
    return clone.textContent?.replaceAll("\u200b", "").trim();
  })).toBe("复制文字");

  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Backspace");
  await expect(composer.locator("[data-upload-item-id]")).toHaveCount(0);
  await page.keyboard.press("Meta+V");
  await expect(composer.locator("[data-upload-item-id]")).toHaveCount(1);
});

test("does not leak pinyin letters when composing Chinese after a pasted image", async ({ page }) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: /消息输入框|Message input/ });
  await composer.locator("xpath=ancestor::footer").locator('input[type="file"]').setInputFiles({
    name: "ime-after-image.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  await expect(composer.locator("[data-upload-item-id]")).toHaveCount(1);
  await composer.locator("[data-upload-caret-anchor]").evaluate((anchor) => {
    const range = document.createRange();
    range.selectNodeContents(anchor);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  const textAfterComposition = await composer.evaluate((editor) => {
    const anchor = editor.querySelector<HTMLElement>("[data-upload-caret-anchor]");
    if (!anchor) throw new Error("upload caret anchor missing");
    editor.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "d" }));
    anchor.textContent = "\u200b的";
    const textNode = anchor.firstChild;
    if (!textNode) throw new Error("anchor text node missing");
    const range = document.createRange();
    range.setStart(textNode, anchor.textContent.length);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    editor.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "的" }));
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "的" }));
    const clone = editor.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("[data-upload-item-id]").forEach((node) => node.remove());
    return {
      html: editor.innerHTML,
      text: (clone.textContent ?? "").replaceAll("\u200b", "").trim(),
    };
  });

  expect(textAfterComposition.html).not.toContain(">d<");
  expect(textAfterComposition.text, textAfterComposition.html).toBe("的");
});

test("restores message actions after dismissing the agent menu outside", async ({ page, request }) => {
  const roomBundle = await (await request.post("/api/rooms", { data: { title: "Agent Menu Hover Room" } })).json();
  await request.post(`/api/conversations/${roomBundle.conversation.id}/messages`, {
    data: { content: "Hover actions must return", artifactIds: [], mentions: [] },
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Agent Menu Hover Room/ }).click();

  const message = page.getByRole("article").filter({ hasText: "Hover actions must return" });
  const actions = message.locator('[data-slot="message-actions"]');
  await message.hover();
  await expect(actions).toHaveCSS("opacity", "1");
  await actions.getByRole("button", { name: /发送给|Send to/ }).click();
  await expect(page.locator("[data-agent-forward-submenu]")).toBeVisible();

  await page.mouse.click(20, 20);
  await expect(page.locator("[data-agent-forward-submenu]")).toBeHidden();
  await page.waitForTimeout(180);
  await expect(actions).toHaveCSS("opacity", "0");

  await message.hover();
  await expect(actions).toHaveCSS("opacity", "1");
});

test("pastes only the exact text selected from a message", async ({ context, page, request }) => {
  const roomBundle = await (await request.post("/api/rooms", { data: { title: "Exact Selection Room" } })).json();
  const fullText = "用这个应用做一个音乐网站";
  await request.post(`/api/conversations/${roomBundle.conversation.id}/messages`, {
    data: { content: fullText, artifactIds: [], mentions: [] },
  });
  await page.goto("/");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  await page.getByRole("button", { name: /Exact Selection Room/ }).click();

  const messageText = page.getByRole("paragraph").filter({ hasText: fullText });
  await messageText.evaluate((element) => {
    const textNode = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes("应用做"));
    if (!textNode?.textContent) throw new Error("message text node missing");
    const start = textNode.textContent.indexOf("应用做");
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + 3);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.press("Meta+C");

  const composer = page.getByRole("textbox", { name: /消息输入框|Message input/ });
  await composer.click();
  await page.keyboard.press("Meta+V");
  await expect(composer).toHaveText("应用做");
});

test("pastes the same copied message image more than once", async ({ context, page, request }) => {
  const roomBundle = await (await request.post("/api/rooms", { data: { title: "Repeated Image Room" } })).json();
  const imageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const uploaded = await (await request.post(`/api/conversations/${roomBundle.conversation.id}/artifacts`, {
    data: { filename: "repeat.png", mimeType: "image/png", dataBase64: imageBase64 },
  })).json();
  await request.post(`/api/conversations/${roomBundle.conversation.id}/messages`, {
    data: { content: "", artifactIds: [uploaded.artifact.id], mentions: [] },
  });
  await page.goto("/");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  await page.getByRole("button", { name: /Repeated Image Room/ }).click();

  const image = page.getByRole("button", { name: "repeat.png" });
  await image.evaluate((element) => {
    const range = document.createRange();
    range.selectNode(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.press("Meta+C");

  const composer = page.getByRole("textbox", { name: /消息输入框|Message input/ });
  await composer.click();
  await page.keyboard.press("Meta+V");
  await page.keyboard.press("Meta+V");
  await expect(page.locator("[data-upload-item-id]")).toHaveCount(2);
  const caretMetrics = await composer.evaluate((editor) => {
    const chips = editor.querySelectorAll("[data-upload-item-id]");
    const selection = window.getSelection();
    if (chips.length !== 2 || !selection?.rangeCount) return null;
    const secondChip = chips[1] as HTMLElement;
    const anchor = secondChip.nextElementSibling as HTMLElement | null;
    const range = selection.getRangeAt(0);
    if (!anchor) return null;
    const anchorRect = anchor.getBoundingClientRect();
    const chipRect = secondChip.getBoundingClientRect();
    return {
      caretInsideAnchor: range.collapsed && anchor.contains(range.startContainer),
      anchorHeight: anchorRect.height,
      bottomDelta: Math.abs(anchorRect.bottom - chipRect.bottom),
    };
  });
  expect(caretMetrics?.caretInsideAnchor).toBe(true);
  expect(caretMetrics?.anchorHeight).toBeLessThanOrEqual(20);
  expect(caretMetrics?.bottomDelta).toBeLessThanOrEqual(3);

  await page.keyboard.type("323");
  const trailingTextMetrics = await composer.evaluate((editor) => {
    const chip = editor.querySelectorAll("[data-upload-item-id]")[1] as HTMLElement;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let textNode: Text | null = null;
    while (walker.nextNode()) {
      const candidate = walker.currentNode as Text;
      if (candidate.textContent?.includes("323")) {
        textNode = candidate;
        break;
      }
    }
    if (!textNode) return null;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rects = [...range.getClientRects()];
    return {
      text: textNode.textContent?.replaceAll("\u200b", ""),
      lineCount: new Set(rects.map((rect) => Math.round(rect.top))).size,
      startsAfterImage: rects[0]?.left >= chip.getBoundingClientRect().right,
    };
  });
  expect(trailingTextMetrics).toEqual({ text: "323", lineCount: 1, startsAfterImage: true });

  const pastedImages = page.locator("[data-upload-item-id]");
  const firstImageBox = await pastedImages.nth(0).boundingBox();
  const secondImageBox = await pastedImages.nth(1).boundingBox();
  if (!firstImageBox || !secondImageBox) throw new Error("image geometry unavailable");
  await page.mouse.click(
    (firstImageBox.x + firstImageBox.width + secondImageBox.x) / 2,
    firstImageBox.y + firstImageBox.height / 2,
  );
  await page.keyboard.type("中");
  expect(await composer.evaluate((editor) => {
    const nodes = [...editor.childNodes];
    const firstImage = nodes.findIndex((node) => node instanceof HTMLElement && node.dataset.uploadItemId);
    const text = nodes.findIndex((node) => node.textContent?.includes("中"));
    const secondImage = nodes.findIndex((node, index) => index > firstImage && node instanceof HTMLElement && node.dataset.uploadItemId);
    return firstImage < text && text < secondImage;
  })).toBe(true);

  await composer.evaluate((editor, externalImageBase64) => {
    const bytes = Uint8Array.from(atob(externalImageBase64), (character) => character.charCodeAt(0));
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([bytes], "external.png", { type: "image/png" }));
    editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, imageBase64);
  await expect(page.getByRole("button", { name: "Preview external.png" })).toBeVisible();
});

test("copies an image resent from group files through its message image action", async ({ context, page, request }) => {
  const roomBundle = await (await request.post("/api/rooms", { data: { title: "Resent Group File Copy Room" } })).json();
  const imageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const uploaded = await (await request.post(`/api/conversations/${roomBundle.conversation.id}/artifacts`, {
    data: { filename: "resent-group-file.png", mimeType: "image/png", dataBase64: imageBase64 },
  })).json();
  await request.post(`/api/conversations/${roomBundle.conversation.id}/messages`, {
    data: { content: "", artifactIds: [uploaded.artifact.id], mentions: [] },
  });
  await request.post(`/api/conversations/${roomBundle.conversation.id}/messages`, {
    data: { content: "", artifactIds: [uploaded.artifact.id], mentions: [] },
  });

  await page.goto("/");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  await page.getByRole("button", { name: /Resent Group File Copy Room/ }).click();

  const resentMessage = page.getByRole("article").filter({ has: page.getByRole("button", { name: "resent-group-file.png" }) }).last();
  const resentImage = resentMessage.locator('[data-slot="artifact-block"][data-artifact-id]').last();
  const artifactId = await resentImage.getAttribute("data-artifact-id");
  expect(artifactId).toBe(uploaded.artifact.id);
  await resentImage.hover();
  const nativeCopy = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && response.url().endsWith(`/api/artifacts/${uploaded.artifact.id}/copy-image`),
  );
  await resentMessage.getByRole("button", { name: /^(复制|Copy)$/ }).click();
  expect((await nativeCopy).ok()).toBe(true);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("group-chat:artifact-ids"))).toContain(uploaded.artifact.id);

  const composer = page.getByRole("textbox", { name: /消息输入框|Message input/ });
  await composer.click();
  await page.keyboard.press("Meta+V");
  await expect(composer.getByRole("button", { name: "Preview resent-group-file.png" })).toBeVisible();
});

test("selects an image attachment when dragging left from composer text", async ({ page }) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: /消息输入框|Message input/ });
  await composer.locator("xpath=ancestor::footer").locator('input[type="file"]').setInputFiles({
    name: "selection.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  await composer.focus();
  await page.keyboard.type("222");

  const attachment = page.locator("[data-upload-item-id]");
  await expect(attachment).toBeVisible();
  const attachmentBox = await attachment.boundingBox();
  if (!attachmentBox) throw new Error("composer geometry unavailable");

  await page.mouse.move(attachmentBox.x + attachmentBox.width + 18, attachmentBox.y + attachmentBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(attachmentBox.x + attachmentBox.width / 2, attachmentBox.y + attachmentBox.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(attachment).toHaveAttribute("data-selected", "");
});

test("keeps an image pasted at the end visually after existing text", async ({ page }) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: /消息输入框|Message input/ });
  await composer.fill("1");
  await composer.evaluate((editor, imageBase64) => {
    const bytes = Uint8Array.from(atob(imageBase64), (character) => character.charCodeAt(0));
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([bytes], "after-text.png", { type: "image/png" }));
    editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");

  const attachment = page.locator("[data-upload-item-id]");
  await expect(attachment).toBeVisible();
  const placeholder = composer.locator("xpath=preceding-sibling::*[@data-slot='composer-placeholder']");
  await expect(placeholder).toBeHidden();
  expect(await composer.evaluate((editor) => {
    const attachment = editor.querySelector("[data-upload-item-id]");
    const selection = window.getSelection();
    if (!attachment || !selection?.rangeCount) return false;
    const nodes = [...editor.childNodes];
    const textIndex = nodes.findIndex((node) => node.textContent?.includes("1"));
    const attachmentIndex = nodes.indexOf(attachment);
    const range = selection.getRangeAt(0);
    const caretAnchor = attachment.nextElementSibling;
    return textIndex < attachmentIndex
      && range.collapsed
      && Boolean(caretAnchor?.contains(range.startContainer));
  })).toBe(true);

  const attachmentBox = await attachment.boundingBox();
  if (!attachmentBox) throw new Error("attachment geometry unavailable");
  await page.mouse.click(attachmentBox.x - 2, attachmentBox.y + attachmentBox.height / 2);
  await page.keyboard.type("中");
  expect(await composer.evaluate((editor) => {
    const attachment = editor.querySelector("[data-upload-item-id]");
    if (!attachment) return false;
    const nodes = [...editor.childNodes];
    const attachmentIndex = nodes.indexOf(attachment);
    return nodes.slice(0, attachmentIndex).some((node) => node.textContent?.includes("1中"));
  })).toBe(true);

  await attachment.click();
  const previewDialog = page.getByRole("dialog", { name: "after-text.png" });
  await expect(previewDialog).toBeVisible();
  const chatHeader = page.locator("main header").first();
  const headerBox = await chatHeader.boundingBox();
  if (!headerBox) throw new Error("chat header geometry unavailable");
  expect(await page.evaluate(({ x, y }) => {
    const topElement = document.elementFromPoint(x, y);
    return Boolean(topElement?.closest('[data-slot="attachment-preview-overlay"]'));
  }, { x: headerBox.x + headerBox.width / 2, y: headerBox.y + headerBox.height / 2 })).toBe(true);
  await previewDialog.getByRole("button", { name: /关闭预览|Close preview/ }).click();
});

test("copies and resends a selected video through the same artifact link", async ({ context, page, request }) => {
  const roomBundle = await (await request.post("/api/rooms", { data: { title: "Pasted Video Room" } })).json();
  await page.goto("/");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  await page.getByRole("button", { name: /Pasted Video Room/ }).click();

  const composer = page.getByRole("textbox", { name: /消息输入框|Message input/ });
  await composer.evaluate((editor) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([new Uint8Array([26, 69, 223, 163])], "pasted-video.webm", { type: "video/webm" }));
    editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });

  const videoChip = composer.locator('[data-upload-mime-type="video/webm"]');
  await expect(videoChip).toBeVisible();
  await expect(videoChip.locator("video")).toHaveAttribute("src", /^blob:/);
  await expect(videoChip.locator("[data-upload-progress]")).toBeHidden();

  await page.route("**/api/conversations/*/artifacts", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });
  await page.getByLabel(/Send message|发送消息/).click();
  await expect(videoChip).toHaveAttribute("aria-busy", "true");
  await expect(videoChip.locator("[data-upload-progress]")).toBeVisible();

  const firstTimelineVideo = page.locator('article [data-slot="artifact-block"] video[aria-label="pasted-video.webm"]');
  await expect(firstTimelineVideo).toBeVisible();
  await expect(firstTimelineVideo).toHaveAttribute("controls", "");
  const artifactBlock = firstTimelineVideo.locator('xpath=ancestor::*[@data-slot="artifact-block"]');
  const artifactId = await artifactBlock.getAttribute("data-artifact-id");
  expect(artifactId).toBeTruthy();

  const copyContent = firstTimelineVideo.locator('xpath=ancestor::*[@data-slot="message-copy-content"]');
  await copyContent.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(artifactBlock).toHaveAttribute("data-copy-selected", "");
  await page.keyboard.press("Meta+C");

  await composer.click();
  await page.keyboard.press("Meta+V");
  const copiedVideoChip = composer.locator('[data-upload-mime-type="video/webm"]');
  await expect(copiedVideoChip).toBeVisible();
  await expect(copiedVideoChip.locator("video")).toHaveAttribute("src", /\/local-assets\//);

  const resendRequestPromise = page.waitForRequest((incoming) =>
    incoming.method() === "POST"
    && incoming.url().endsWith(`/api/conversations/${roomBundle.conversation.id}/messages`),
  );
  await page.getByLabel(/Send message|发送消息/).click();
  const resendRequest = await resendRequestPromise;
  const resendBody = JSON.parse(resendRequest.postData() ?? "{}") as {
    artifactIds?: string[];
    parts?: Array<{ type: string; artifactId?: string }>;
  };
  expect([
    ...(resendBody.artifactIds ?? []),
    ...(resendBody.parts ?? []).map((part) => part.artifactId).filter(Boolean),
  ]).toContain(artifactId);

  await expect(page.locator(`article [data-slot="artifact-block"][data-artifact-id="${artifactId}"] video`)).toHaveCount(2);
  await page.getByLabel(/View group files|查看群内文件/).click();
  const filesPanel = page.locator("aside").filter({ has: page.getByRole("heading", { name: /群内文件|Group files/ }) });
  await expect(filesPanel.getByText("pasted-video.webm", { exact: true })).toHaveCount(1);
});

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
