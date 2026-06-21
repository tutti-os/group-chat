import { expect, test } from "@playwright/test";

test("starts at the minimum sidebar width and restores a dragged width", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("group-chat:conversation-sidebar-width"));
  await page.reload();

  const splitter = page.getByRole("button", { name: /调整会话列表|resize sidebar/i });
  const initialBox = await splitter.boundingBox();
  if (!initialBox) throw new Error("sidebar splitter geometry unavailable");
  expect(Math.round(initialBox.x)).toBe(300);

  await page.mouse.move(initialBox.x + 1, initialBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(initialBox.x + 80, initialBox.y + 20);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("group-chat:conversation-sidebar-width"))).toBe("320");

  await page.reload();
  const restoredBox = await splitter.boundingBox();
  if (!restoredBox) throw new Error("restored sidebar splitter geometry unavailable");
  expect(Math.round(restoredBox.x)).toBe(380);
});

test("keeps the latest message close to the composer", async ({ page, request }) => {
  const roomBundle = await (await request.post("/api/rooms", { data: { title: "Compact Timeline Bottom Room" } })).json();
  for (let index = 0; index < 18; index += 1) {
    await request.post(`/api/conversations/${roomBundle.conversation.id}/messages`, {
      data: { content: index === 17 ? "Latest message spacing" : `Filler message ${index}`, mentions: [] },
    });
  }
  await page.goto("/");
  await page.getByRole("button", { name: /Compact Timeline Bottom Room/ }).click();
  const article = page.getByRole("article").filter({ hasText: "Latest message spacing" });
  const footer = page.getByRole("textbox", { name: /消息输入框|Message input/ }).locator("xpath=ancestor::footer");
  await expect(article).toBeVisible();
  const gap = await article.evaluate((element) => {
    const timeline = element.closest("section");
    const footer = timeline?.nextElementSibling;
    if (!(footer instanceof HTMLElement)) return null;
    return footer.getBoundingClientRect().top - element.getBoundingClientRect().bottom;
  });
  expect(gap).not.toBeNull();
  expect(gap!).toBeLessThanOrEqual(9);
  await expect(footer).toBeVisible();
});

test("keeps compact conversation rows and puts delete in room settings", async ({ page, request }) => {
  await request.post("/api/rooms", { data: { title: "Sidebar Metadata Room" } });
  await page.goto("/");
  const roomButton = page.getByRole("button", { name: /Sidebar Metadata Room/ });
  const row = roomButton.locator("xpath=..");
  const time = row.locator('[data-slot="conversation-time"]');
  await expect(time).toHaveText(/^\d{2}:\d{2}$/);
  await expect(row.locator('[data-slot="conversation-delete"]')).toHaveCount(0);
  expect(await row.evaluate((element) => element.getBoundingClientRect().height)).toBe(56);
  const geometry = await row.evaluate((element) => {
    const time = element.querySelector<HTMLElement>('[data-slot="conversation-time"]');
    if (!time) return null;
    const rowRect = element.getBoundingClientRect();
    const timeRect = time.getBoundingClientRect();
    return { timeRightGap: rowRect.right - timeRect.right };
  });
  expect(geometry?.timeRightGap).toBeLessThanOrEqual(9);

  await roomButton.click();
  await page.getByRole("button", { name: /群设置|room settings/i }).first().click();
  const dialog = page.getByRole("region", { name: /群设置|Room settings/i });
  const remove = dialog.getByRole("button", { name: /删除聊天|Delete chat/i });
  await expect(remove).toBeVisible();
  const deleteBottomGap = await dialog.evaluate((element) => {
    const panel = element.firstElementChild as HTMLElement | null;
    const deleteButton = [...element.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => /删除聊天|Delete chat/i.test(button.textContent ?? ""));
    if (!panel || !deleteButton) return null;
    return panel.getBoundingClientRect().bottom - deleteButton.getBoundingClientRect().bottom;
  });
  expect(deleteBottomGap).toBeLessThanOrEqual(25);
});
