import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("Codex target enrichment reads models and defaults from its detected config directory", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "group-chat-codex-config-"));
  const output = join(configDir, "catalog.mjs");
  try {
    await writeFile(
      join(configDir, "config.toml"),
      'model = "gpt-config-default"\nmodel_reasoning_effort = "high"\n',
    );
    await writeFile(
      join(configDir, "models_cache.json"),
      JSON.stringify({
        models: [{
          slug: "gpt-config-default",
          display_name: "GPT Config Default",
          supported_reasoning_levels: [{ effort: "high" }],
        }],
      }),
    );
    await execFileAsync("pnpm", [
      "--filter",
      "@group-chat/server",
      "exec",
      "esbuild",
      "src/runtimes/local-agent-config-catalog.ts",
      "--bundle",
      "--platform=node",
      "--format=esm",
      `--outfile=${output}`,
    ]);
    const { enrichLocalAgentTargetStatus } = await import(`${pathToFileURL(output)}?t=${Date.now()}`);
    const enriched = enrichLocalAgentTargetStatus({
      agentTargetId: "team:codex",
      providerId: "codex",
      provider: "codex",
      displayName: "Codex",
      runtimeSupported: true,
      availabilityStatus: "available",
      available: true,
      authState: "ok",
      executablePath: "",
      version: "detected",
      configDir,
      models: [{ id: "default", label: "Default" }],
    });

    assert.equal(enriched.defaultModelId, "gpt-config-default");
    assert.equal(enriched.defaultReasoningEffort, "high");
    assert.deepEqual(enriched.models.map((model) => model.id), ["default", "gpt-config-default"]);
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});
