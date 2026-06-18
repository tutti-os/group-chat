import { expect, test } from "@playwright/test";

test("creates an agent room, attaches a file, mentions an agent, and receives a reply", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "消息" })).toBeVisible();

  await page.getByTitle("Team members").click();
  await page.getByTitle("New team member").click();
  await page.getByRole("button", { name: "资料" }).click();
  await expect(page.getByLabel("Name")).toHaveValue(/Agent/);
  await page.getByLabel("Name").fill("Planner UI");
  await page.getByLabel("Icon").fill("PU");
  await page.getByLabel("Role Description").fill("You are Planner UI. Reply to smoke tests with one concise sentence.");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByLabel("Close agent settings").click();
  await expect(page.locator(".teamList").getByRole("button", { name: /Planner UI/ })).toBeVisible();
  await page.getByTitle("New team member").click();
  await page.getByRole("button", { name: "资料" }).click();
  await expect(page.getByLabel("Name")).toHaveValue(/Agent/);
  await page.getByLabel("Name").fill("Critic UI");
  await page.getByLabel("Icon").fill("CU");
  await page.getByLabel("Role Description").fill("You are Critic UI. Stay concise in smoke tests.");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByLabel("Close agent settings").click();
  await expect(page.locator(".teamList").getByRole("button", { name: /Critic UI/ })).toBeVisible();
  await page.getByLabel("New local agent").click();
  await page.getByLabel("Close agent settings").click();
  await expect(page.locator(".teamList").getByRole("button", { name: /本地 Agent/ })).toBeVisible();
  await expect(page.locator(".teamList").getByRole("button", { name: /本地 Agent/ })).toContainText(/Codex Local Agent/);

  await page.getByLabel("我 profile").click();
  await page.getByRole("menuitem", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await page.getByRole("button", { name: "模型" }).click();
  const settingsDialog = page.getByRole("region", { name: "Settings" });
  await expect(settingsDialog).toContainText("本地 Agent");
  await expect(settingsDialog).toContainText(/Local Agent/);
  await page.getByLabel("Close settings").click();

  await page.getByTitle("Chats").click();
  await page.getByTitle("New room").click();
  await expect(page.getByRole("heading", { name: /AI 讨论室/ })).toBeVisible();
  await page.getByRole("button", { name: "Room", exact: true }).click();
  await page.locator(".roomEditor input").fill("UI Strategy Room");
  await page.locator(".roomEditor textarea").fill("GUI room settings smoke.");
  await page.locator(".roomEditor").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "UI Strategy Room" })).toBeVisible();
  await page.getByLabel("Search rooms").fill("Strategy");
  await expect(page.locator(".conversationList")).toContainText("UI Strategy Room");
  await page.getByLabel("Search rooms").fill("missing-room");
  await expect(page.locator(".conversationList")).toContainText("No matching rooms");
  await page.getByLabel("Search rooms").fill("");

  await page.getByRole("button", { name: "Policy" }).click();
  await page.locator(".policyEditor select").nth(1).selectOption("parallel");
  await page.locator(".policyEditor").getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".policyBadge")).toContainText("parallel");

  await page.getByRole("button", { name: /Add team member/ }).click();
  await page.getByLabel("Reasoning effort for new member").selectOption("high");
  await page.getByLabel("Room-specific instructions for new member").fill("Planner owns UI smoke planning.");
  await page.getByRole("button", { name: "Add" }).click();
  const plannerChip = page.locator(".participantChip").filter({ has: page.getByLabel("Edit Planner UI") });
  await expect(plannerChip).toBeVisible();
  await plannerChip.hover();
  await page.getByLabel("Edit Planner UI").click();
  await expect(page.getByLabel("Reasoning effort for Planner UI")).toHaveValue("high");
  await expect(page.getByLabel("Room-specific instructions for Planner UI")).toHaveValue("Planner owns UI smoke planning.");
  await page.getByLabel("Cancel editing Planner UI").click();
  await page.getByRole("button", { name: /Add team member/ }).click();
  await page.getByRole("button", { name: "Add" }).click();
  const criticChip = page.locator(".participantChip").filter({ has: page.getByLabel("Edit Critic UI") });
  await expect(criticChip).toBeVisible();

  const composer = page.getByRole("textbox", { name: "消息输入框" });
  await expect(page.getByLabel("Stop responses")).toHaveCount(0);
  await expect(page.getByLabel("Run inspector")).toHaveCount(0);
  await expect(page.getByLabel("Responder preview")).toHaveCount(0);

  await page.getByRole("button", { name: "Policy" }).click();
  await page.locator(".policyEditor select").first().selectOption("selected");
  await page.locator(".policyEditor").getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".policyBadge")).toContainText("selected");
  await expect(page.getByLabel("Responder preview")).toHaveCount(0);
  await page.getByLabel("Select Planner UI as responder").click();
  await expect(page.getByLabel("Responder preview")).toContainText("Manual targets");
  await expect(page.getByLabel("Responder preview")).toContainText("Planner UI");
  await expect(page.getByLabel("Responder preview")).not.toContainText("Critic UI");
  await composer.fill("Manual selected target smoke.");
  const selectedTargetRequest = page.waitForRequest((request) =>
    request.method() === "POST" &&
    request.url().includes("/api/conversations/") &&
    request.url().endsWith("/messages") &&
    (request.postData() ?? "").includes("Manual selected target smoke."),
  );
  await page.getByLabel("Send message").click();
  const selectedTargetBody = JSON.parse((await selectedTargetRequest).postData() ?? "{}") as {
    mentions?: Array<{ mentionType?: string; displayNameSnapshot?: string }>;
  };
  expect(selectedTargetBody.mentions).toEqual(
    expect.arrayContaining([expect.objectContaining({ mentionType: "participant", displayNameSnapshot: "Planner UI" })]),
  );
  await expect(page.locator(".messageRow.user").filter({ hasText: "Manual selected target smoke." })).toBeVisible();

  await page.getByRole("button", { name: "Policy" }).click();
  await page.locator(".policyEditor select").first().selectOption("all");
  await page.locator(".policyEditor select").nth(1).selectOption("parallel");
  await page.locator(".policyEditor").getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".policyBadge")).toContainText("all");

  await composer.fill("@");
  await page.locator(".mentionMenu").getByRole("button", { name: /Planner UI/ }).click();
  await expect(composer).toHaveValue("@Planner UI ");
  await expect(page.getByLabel("Responder preview")).toContainText("Mention targets");
  await expect(page.getByLabel("Responder preview")).toContainText("Planner UI");
  await expect(page.getByLabel("Responder preview")).not.toContainText("Critic UI");
  await composer.fill("@Planner UI please read the attached UI smoke brief.");

  await page.locator('input[type="file"]').setInputFiles({
    name: "remove-me.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("This attachment should be removed before sending.", "utf8"),
  });
  await expect(page.locator(".pendingArtifacts").getByText("remove-me.txt")).toBeVisible();
  await page.getByLabel("Remove remove-me.txt").click();
  await expect(page.locator(".pendingArtifacts").getByText("remove-me.txt")).toHaveCount(0);

  await page.locator('input[type="file"]').setInputFiles({
    name: "ui-smoke-brief.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("UI smoke file reference: answer concisely.", "utf8"),
  });
  await expect(page.locator(".pendingArtifacts").getByText("ui-smoke-brief.txt")).toBeVisible();

  await page.getByLabel("Send message").click();

  await expect(page.getByLabel("Stop responses")).toBeEnabled();
  await expect(page.getByLabel("Run inspector")).toContainText("Planner UI");
  await expect(page.locator(".messageRow.user").filter({ hasText: "please read the attached UI smoke brief" })).toBeVisible();
  await expect(page.locator(".messageRow.user").filter({ hasText: "ui-smoke-brief.txt" })).toBeVisible();
  await expect(page.locator(".messageRow.assistant").filter({ hasText: "Planner UI" })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".messageRow.assistant .messageBlock").filter({ hasText: /Planner UI|demo|attached|brief/i })).toBeVisible();
  await expect(page.getByLabel("Run inspector")).toContainText("running");

  await expect(page.getByLabel("Room files")).toContainText("ui-smoke-brief.txt");
  await page.getByLabel("Use ui-smoke-brief.txt").click();
  await expect(page.locator(".pendingArtifacts").getByText("ui-smoke-brief.txt")).toBeVisible();
  await page.getByLabel("Remove ui-smoke-brief.txt").click();
  await expect(page.locator(".pendingArtifacts").getByText("ui-smoke-brief.txt")).toHaveCount(0);
  await page.getByLabel("Reference room file").click();
  await page.getByLabel("Room file references").getByRole("button", { name: /ui-smoke-brief\.txt/ }).click();
  await expect(page.locator(".pendingArtifacts").getByText("ui-smoke-brief.txt")).toBeVisible();
  await composer.fill("Use the same room file again.");
  await page.getByLabel("Send message").click();
  await expect(page.locator(".messageRow.user").filter({ hasText: "Use the same room file again." })).toBeVisible();
  await expect(page.locator(".messageRow.user").filter({ hasText: "ui-smoke-brief.txt" })).toHaveCount(2);

  await composer.fill("@");
  await page.locator(".mentionMenu").getByRole("button", { name: /all agents/ }).click();
  await expect(composer).toHaveValue("@all ");
  await expect(page.getByLabel("Responder preview")).toContainText("Responders");
  await expect(page.getByLabel("Responder preview")).toContainText("Planner UI");
  await expect(page.getByLabel("Responder preview")).toContainText("Critic UI");
  await composer.fill("@all no reply, just checking everyone.");
  const allMentionRequest = page.waitForRequest((request) =>
    request.method() === "POST" &&
    request.url().includes("/api/conversations/") &&
    request.url().endsWith("/messages") &&
    (request.postData() ?? "").includes("@all"),
  );
  await page.getByLabel("Send message").click();
  const requestBody = JSON.parse((await allMentionRequest).postData() ?? "{}") as {
    mentions?: Array<{ mentionType?: string; participantId?: string }>;
  };
  expect(requestBody.mentions).toEqual(
    expect.arrayContaining([expect.objectContaining({ mentionType: "all", participantId: "all" })]),
  );
  await expect(page.locator(".messageRow.user").filter({ hasText: "@all no reply" })).toBeVisible();

  await criticChip.hover();
  await page.getByLabel("Remove Critic UI from room").click();
  await expect(page.getByLabel("Remove Critic UI from room")).toHaveCount(0);
  await expect(page.getByLabel("Responder preview")).toHaveCount(0);

  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain('Delete chat "UI Strategy Room"');
    void dialog.accept();
  });
  await page.locator(".conversationItem").filter({ hasText: "UI Strategy Room" }).getByTitle("Delete chat").click();
  await expect(page.locator(".conversationList")).not.toContainText("UI Strategy Room");
});
