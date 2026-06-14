import { expect, test, type Browser, type Page } from "@playwright/test";

test.describe("multiplayer future contract", () => {
  test.skip(
    process.env.GROUP_CHAT_RUN_MULTIPLAYER_E2E !== "1",
    "future multiplayer contract; set GROUP_CHAT_RUN_MULTIPLAYER_E2E=1 to run",
  );

  test("keeps three joined users synchronized while isolating private state", async ({ browser }) => {
    const alice = await openUser(browser, "user-alice", "Alice", "saiyan-01");
    const bob = await openUser(browser, "user-bob", "Bob", "saiyan-02");
    const carol = await openUser(browser, "user-carol", "Carol", "saiyan-03");

    await expect(alice.page.getByRole("heading", { name: "消息" })).toBeVisible();
    await expect(bob.page.getByRole("heading", { name: "消息" })).toBeVisible();
    await expect(carol.page.getByRole("heading", { name: "消息" })).toBeVisible();

    await alice.page.getByPlaceholder("发送消息，输入 / 使用命令...").fill("Alice public hello");
    await alice.page.getByLabel("Send message").click();

    await expect(bob.page.locator(".messageRow.user").filter({ hasText: "Alice public hello" })).toBeVisible();
    await expect(carol.page.locator(".messageRow.user").filter({ hasText: "Alice public hello" })).toBeVisible();

    await alice.page.getByPlaceholder("发送消息，输入 / 使用命令...").fill("@Bob @Planner private plan");
    await alice.page.getByLabel("Send message").click();

    await expect(alice.page.locator(".messageRow").filter({ hasText: "private plan" })).toBeVisible();
    await expect(bob.page.locator(".messageRow").filter({ hasText: "private plan" })).toBeVisible();
    await expect(carol.page.locator(".messageRow").filter({ hasText: "private plan" })).toHaveCount(0);

    await bob.page.locator(".messageRow").filter({ hasText: "Alice public hello" }).hover();
    await bob.page.getByLabel(/Delete message|删除消息/).click();
    await bob.page.getByRole("button", { name: /Delete|删除/ }).click();
    await expect(bob.page.locator(".messageRow").filter({ hasText: "Alice public hello" })).toHaveCount(0);
    await expect(alice.page.locator(".messageRow").filter({ hasText: "Alice public hello" })).toBeVisible();

    await bob.page.getByPlaceholder("发送消息，输入 / 使用命令...").fill("Bob concurrent reply");
    await carol.page.getByPlaceholder("发送消息，输入 / 使用命令...").fill("Carol concurrent reply");
    await Promise.all([
      bob.page.getByLabel("Send message").click(),
      carol.page.getByLabel("Send message").click(),
    ]);

    await expect(alice.page.locator(".messageRow.user").filter({ hasText: "Bob concurrent reply" })).toBeVisible();
    await expect(alice.page.locator(".messageRow.user").filter({ hasText: "Carol concurrent reply" })).toBeVisible();

    await closeUsers(alice, bob, carol);
  });
});

async function openUser(
  browser: Browser,
  userId: string,
  displayName: string,
  avatarPreset: string,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  await context.addInitScript(({ userId: nextUserId, profile }) => {
    window.localStorage.setItem("group-chat:user-id", nextUserId);
    window.localStorage.setItem("group-chat:user-profile", JSON.stringify(profile));
  }, {
    userId,
    profile: {
      displayName,
      avatarPreset,
      customAvatarUrl: null,
      bio: `${displayName} multiplayer test user.`,
    },
  });
  const page = await context.newPage();
  await page.goto(`/?userId=${encodeURIComponent(userId)}`);
  return { page, close: () => context.close() };
}

async function closeUsers(...users: Array<{ close: () => Promise<void> }>) {
  await Promise.all(users.map((user) => user.close()));
}
