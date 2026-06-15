import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertNoSymlinks,
  createCliManifest,
  createManifest,
  readSourceManifest,
  renderAgentsGuide,
  renderBootstrap,
  renderCommandsDoc,
  renderIcon,
  validatePackageRoot,
} from "../scripts/package-tutti-app.mjs";

async function makeTempPackageRoot() {
  return mkdtemp(path.join(os.tmpdir(), "group-chat-tutti-package-test-"));
}

test("createManifest returns the Tutti package manifest contract", () => {
  assert.deepEqual(createManifest({ version: "1.2.3" }), {
    schemaVersion: "tutti.app.manifest.v1",
    appId: "group-chat",
    version: "1.2.3",
    name: "Group Chat",
    description: "Get work done with your agents in group chat.",
    icon: {
      type: "asset",
      src: "icon.svg",
    },
    runtime: {
      bootstrap: "bootstrap.sh",
      healthcheckPath: "/api/health",
    },
    cli: {
      manifest: "tutti.cli.json",
    },
    references: {
      listEndpoint: "/tutti/references/list",
    },
    window: {
      minimizeBehavior: "keep-mounted",
      minWidth: 960,
      minHeight: 640,
    },
    localizationInfo: {
      defaultLocale: "en",
      additionalLocales: [
        {
          locale: "zh-CN",
          file: "locales/zh-CN/manifest.json",
        },
      ],
    },
    author: {
      name: "Tutti",
    },
    tags: ["local-first", "agent", "chat", "team"],
  });
});

test("root Tutti app manifest matches the generated package manifest", async () => {
  const manifest = await readSourceManifest();

  assert.deepEqual(manifest, createManifest({ version: manifest.version }));
});

test("root Tutti CLI manifest matches the generated package CLI manifest", async () => {
  const manifest = JSON.parse(await readFile("tutti.cli.json", "utf8"));

  assert.deepEqual(manifest, createCliManifest());
});

test("root command documentation matches the generated package command documentation", async () => {
  const commands = await readFile("COMMANDS.md", "utf8");

  assert.equal(commands, renderCommandsDoc());
});

test("bootstrap maps Tutti runtime env into Group Chat env", () => {
  const bootstrap = renderBootstrap({ version: "9.8.7" });

  assert.match(bootstrap, /package_dir="\$\{TUTTI_APP_PACKAGE_DIR:-\$script_dir\}"/);
  assert.match(bootstrap, /export HOST="\$\{TUTTI_APP_HOST:-127\.0\.0\.1\}"/);
  assert.match(bootstrap, /export PORT="\$\{TUTTI_APP_PORT:-8788\}"/);
  assert.match(bootstrap, /export GROUP_CHAT_APP_VERSION="9\.8\.7"/);
  assert.match(bootstrap, /export GROUP_CHAT_HOME="\$\{TUTTI_APP_DATA_DIR:-\$package_dir\/\.data\}"/);
  assert.match(bootstrap, /export GROUP_CHAT_WORKSPACE_ROOT="\$\{TUTTI_WORKSPACE_ROOT:-\$GROUP_CHAT_HOME\}"/);
  assert.match(bootstrap, /node_bin="\$\{TUTTI_APP_NODE:-node\}"/);
  assert.match(bootstrap, /exec "\$node_bin" "\$package_dir\/server\/server\.js"/);
});

test("package guide documents runtime ownership", () => {
  const guide = renderAgentsGuide();

  assert.match(guide, /TUTTI_APP_HOST:TUTTI_APP_PORT/);
  assert.match(guide, /TUTTI_APP_DATA_DIR/);
  assert.match(guide, /GROUP_CHAT_HOME/);
  assert.match(guide, /tutti\.cli\.json/);
});

test("validatePackageRoot accepts the required Tutti package files", async () => {
  const root = await makeTempPackageRoot();
  await mkdir(path.join(root, "server"), { recursive: true });
  await mkdir(path.join(root, "dist"), { recursive: true });
  await mkdir(path.join(root, "locales", "zh-CN"), { recursive: true });
  await writeFile(path.join(root, "tutti.app.json"), `${JSON.stringify(createManifest({ version: "1.2.3" }), null, 2)}\n`);
  await writeFile(path.join(root, "tutti.cli.json"), `${JSON.stringify(createCliManifest(), null, 2)}\n`);
  await writeFile(path.join(root, "COMMANDS.md"), renderCommandsDoc());
  await writeFile(path.join(root, "locales", "zh-CN", "manifest.json"), `${JSON.stringify({ name: "群聊" }, null, 2)}\n`);
  await writeFile(path.join(root, "AGENTS.md"), renderAgentsGuide());
  await writeFile(path.join(root, "bootstrap.sh"), renderBootstrap({ version: "1.2.3" }));
  await chmod(path.join(root, "bootstrap.sh"), 0o755);
  await writeFile(path.join(root, "icon.svg"), renderIcon());
  await writeFile(path.join(root, "server", "server.js"), "console.log('ok');\n");
  await writeFile(path.join(root, "dist", "index.html"), "<!doctype html>\n");

  await validatePackageRoot(root);
});

test("assertNoSymlinks rejects symlinks", async () => {
  const root = await makeTempPackageRoot();
  await writeFile(path.join(root, "target.txt"), "target\n");
  await symlink("target.txt", path.join(root, "link.txt"));

  await assert.rejects(() => assertNoSymlinks(root), /Package contains symlink/);
});

test("root Tutti manifest is valid JSON", async () => {
  const manifest = JSON.parse(await readFile("tutti.app.json", "utf8"));

  assert.equal(manifest.schemaVersion, "tutti.app.manifest.v1");
  assert.equal(manifest.appId, "group-chat");
  assert.equal(manifest.name, "Group Chat");
  assert.equal(manifest.cli.manifest, "tutti.cli.json");
  assert.equal(manifest.references.listEndpoint, "/tutti/references/list");
  assert.equal(manifest.runtime.healthcheckPath, "/api/health");
});
