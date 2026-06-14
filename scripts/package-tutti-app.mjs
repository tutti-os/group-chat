import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), "..");
const buildRoot = path.join(rootDir, "build", "tutti-app");
const packageRoot = path.join(buildRoot, "package");

const APP_ID = "group-chat";
const APP_NAME = "Group Chat";
const MANIFEST_LOCALIZATIONS = {
  "zh-CN": {
    file: "locales/zh-CN/manifest.json",
    metadata: {
      name: "群聊",
      description: "在群里跟你的 Agents 一起干活",
      tags: ["本地优先", "Agent", "群聊", "团队"],
    },
  },
};

export function createManifest({ version }) {
  return {
    schemaVersion: "tutti.app.manifest.v1",
    appId: APP_ID,
    version,
    name: APP_NAME,
    description: "Get work done with your agents in group chat.",
    icon: {
      type: "asset",
      src: "icon.svg",
    },
    runtime: {
      bootstrap: "bootstrap.sh",
      healthcheckPath: "/api/health",
    },
    window: {
      minimizeBehavior: "keep-mounted",
      minWidth: 960,
      minHeight: 640,
    },
    localizationInfo: {
      defaultLocale: "en",
      additionalLocales: Object.entries(MANIFEST_LOCALIZATIONS).map(([locale, { file }]) => ({
        locale,
        file,
      })),
    },
    author: {
      name: "Tutti",
    },
    tags: ["local-first", "agent", "chat", "team"],
  };
}

export function renderBootstrap({ version = "0.0.0" } = {}) {
  return `#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
package_dir="\${TUTTI_APP_PACKAGE_DIR:-$script_dir}"

export HOST="\${TUTTI_APP_HOST:-127.0.0.1}"
export PORT="\${TUTTI_APP_PORT:-8788}"
export GROUP_CHAT_APP_VERSION="${version}"
export GROUP_CHAT_WEB_DIST="$package_dir/dist"
export GROUP_CHAT_HOME="\${TUTTI_APP_DATA_DIR:-$package_dir/.data}"
export GROUP_CHAT_WORKSPACE_ROOT="\${TUTTI_WORKSPACE_ROOT:-$GROUP_CHAT_HOME}"

base_url="\${TUTTI_APP_BASE_URL:-http://$HOST:$PORT}"
export GROUP_CHAT_SERVER_URL="$base_url"

node_bin="\${TUTTI_APP_NODE:-node}"
runtime_dir="\${TUTTI_APP_RUNTIME_DIR:-$GROUP_CHAT_HOME/.runtime}"
mkdir -p "$GROUP_CHAT_HOME" "$runtime_dir"

exec "$node_bin" "$package_dir/server/server.js"
`;
}

export function renderAgentsGuide() {
  return `# Group Chat Tutti Package

This package runs Group Chat as a Tutti workspace app.

## Files

- \`tutti.app.json\`: Tutti app manifest.
- \`bootstrap.sh\`: maps \`TUTTI_APP_*\` runtime variables into Group Chat env and starts the server.
- \`server/server.js\`: bundled Fastify server.
- \`dist/\`: built React/Vite frontend.
- \`icon.svg\`: package icon.

## Runtime

Tutti starts \`bootstrap.sh\` with no arguments. The app binds to
\`TUTTI_APP_HOST:TUTTI_APP_PORT\`, serves \`dist/\`, and stores durable
SQLite data, uploads, room workspaces, and agent workspaces under
\`TUTTI_APP_DATA_DIR\` via \`GROUP_CHAT_HOME\`.

The app intentionally does not expose a \`tutti.cli.json\` manifest in this
phase. Keep the package focused on the GUI/local-agent IM experience.
`;
}

export function renderIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="Group Chat">
  <rect width="1024" height="1024" rx="220" fill="#101820"/>
  <path d="M214 296c0-82 66-148 148-148h300c82 0 148 66 148 148v196c0 82-66 148-148 148H472L326 780c-25 24-66 6-66-29V630c-29-16-46-49-46-88V296Z" fill="#F4F1E8"/>
  <circle cx="386" cy="396" r="46" fill="#2F7D62"/>
  <circle cx="512" cy="396" r="46" fill="#D65245"/>
  <circle cx="638" cy="396" r="46" fill="#E7B84A"/>
  <path d="M366 528h292" stroke="#101820" stroke-width="48" stroke-linecap="round"/>
</svg>
`;
}

export async function readRootPackage() {
  const data = await readFile(path.join(rootDir, "package.json"), "utf8");
  return JSON.parse(data);
}

export async function readSourceManifest() {
  const data = await readFile(path.join(rootDir, "tutti.app.json"), "utf8");
  return JSON.parse(data);
}

async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: "inherit",
      shell: false,
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function writePackageFiles(manifest) {
  await rm(packageRoot, { force: true, recursive: true });
  await mkdir(path.join(packageRoot, "server"), { recursive: true });

  await writeFile(
    path.join(packageRoot, "tutti.app.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  for (const { file, metadata } of Object.values(MANIFEST_LOCALIZATIONS)) {
    const localePath = path.join(packageRoot, file);
    await mkdir(path.dirname(localePath), { recursive: true });
    await writeFile(localePath, `${JSON.stringify(metadata, null, 2)}\n`);
  }
  await writeFile(path.join(packageRoot, "AGENTS.md"), renderAgentsGuide());
  await writeFile(path.join(packageRoot, "bootstrap.sh"), renderBootstrap({ version: manifest.version }));
  await chmod(path.join(packageRoot, "bootstrap.sh"), 0o755);
  await writeFile(path.join(packageRoot, "icon.svg"), renderIcon());
  await cp(path.join(rootDir, "apps", "web", "dist"), path.join(packageRoot, "dist"), {
    recursive: true,
  });
}

async function bundleServer() {
  await run("pnpm", [
    "exec",
    "esbuild",
    "apps/server/src/main.ts",
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--target=node22",
    "--outfile=build/tutti-app/package/server/server.js",
    "--banner:js=import { createRequire as __groupChatCreateRequire } from 'node:module'; const require = __groupChatCreateRequire(import.meta.url);",
  ]);
}

async function createZip(version) {
  const zipPath = path.join(buildRoot, `${APP_ID}-${version}.zip`);
  await rm(zipPath, { force: true });
  await run("zip", ["-qry", zipPath, "."], { cwd: packageRoot });
  return zipPath;
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex");
}

export async function assertNoSymlinks(root) {
  const entries = await readdir(root);
  for (const entry of entries) {
    const entryPath = path.join(root, entry);
    const info = await lstat(entryPath);
    if (info.isSymbolicLink()) {
      throw new Error(`Package contains symlink: ${path.relative(root, entryPath)}`);
    }
    if (info.isDirectory()) {
      await assertNoSymlinks(entryPath);
    }
  }
}

export async function validatePackageRoot(root) {
  const requiredFiles = [
    "tutti.app.json",
    "AGENTS.md",
    "bootstrap.sh",
    "icon.svg",
    "server/server.js",
    "dist/index.html",
  ];
  for (const file of requiredFiles) {
    const filePath = path.join(root, file);
    try {
      await access(filePath);
    } catch {
      throw new Error(`Missing required package file: ${file}`);
    }
  }

  const manifest = JSON.parse(await readFile(path.join(root, "tutti.app.json"), "utf8"));
  if (manifest.schemaVersion !== "tutti.app.manifest.v1") {
    throw new Error("Manifest schemaVersion must be tutti.app.manifest.v1");
  }
  if (manifest.appId !== APP_ID) {
    throw new Error(`Manifest appId must be ${APP_ID}`);
  }
  if (manifest.runtime && "kind" in manifest.runtime) {
    throw new Error("Manifest runtime must not declare kind");
  }
  if (manifest.cli) {
    throw new Error("Group Chat GUI package must not include a Tutti CLI manifest");
  }
  if (!manifest.runtime?.bootstrap || !manifest.runtime?.healthcheckPath?.startsWith("/")) {
    throw new Error("Manifest runtime bootstrap and healthcheckPath are required");
  }
  for (const locale of manifest.localizationInfo?.additionalLocales ?? []) {
    const localeFile = locale?.file;
    if (typeof localeFile !== "string" || !localeFile.trim()) {
      throw new Error("Manifest localization file must be a non-empty relative path");
    }
    try {
      await access(path.join(root, localeFile));
    } catch {
      throw new Error(`Missing manifest localization file: ${localeFile}`);
    }
  }

  const bootstrapMode = (await stat(path.join(root, "bootstrap.sh"))).mode;
  if ((bootstrapMode & 0o111) === 0) {
    throw new Error("bootstrap.sh must be executable");
  }
  await assertNoSymlinks(root);
}

export async function packageTuttiApp() {
  const rootPackage = await readRootPackage();
  const sourceManifest = await readSourceManifest();
  const version =
    process.env.GROUP_CHAT_TUTTI_APP_VERSION?.trim() ||
    sourceManifest.version ||
    rootPackage.version ||
    "0.0.0";
  const manifest = {
    ...sourceManifest,
    version,
  };

  await run("pnpm", ["--filter", "@group-chat/web", "build"]);
  await mkdir(buildRoot, { recursive: true });
  await writePackageFiles(manifest);
  await bundleServer();
  await validatePackageRoot(packageRoot);
  const zipPath = await createZip(version);
  const zipSha256 = await sha256File(zipPath);
  const result = {
    appId: manifest.appId,
    version,
    packageRoot,
    zipPath,
    zipSha256,
  };
  await writeFile(path.join(buildRoot, "package-result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Created ${zipPath}`);
  return result;
}

if (process.argv[1] === scriptPath) {
  packageTuttiApp().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
