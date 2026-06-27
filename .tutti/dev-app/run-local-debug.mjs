import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(process.env.GROUP_CHAT_PROJECT_ROOT || join(here, "..", ".."));
const nodeBin = process.env.TUTTI_APP_NODE;
const host = process.env.TUTTI_APP_HOST || "127.0.0.1";
const port = process.env.TUTTI_APP_PORT;

function fail(message) {
  console.error(`[group-chat-dev] ${message}`);
  process.exit(1);
}

function requireFile(relativePath, hint) {
  const filePath = join(projectRoot, relativePath);
  if (!existsSync(filePath)) {
    fail(`${relativePath} is missing. ${hint}`);
  }
  return filePath;
}

if (!nodeBin) {
  fail("TUTTI_APP_NODE is required.");
}

if (!port) {
  fail("TUTTI_APP_PORT is required.");
}

const tscBin = requireFile("node_modules/typescript/bin/tsc", "Install the project dependencies before loading the dev app.");
const viteBin = requireFile("apps/web/node_modules/vite/bin/vite.js", "Install the web workspace dependencies before loading the dev app.");
const tsxBin = requireFile("apps/server/node_modules/tsx/dist/cli.mjs", "Install the server workspace dependencies before loading the dev app.");
const webDist = join(projectRoot, "apps", "web", "dist");

const runtimeDir = process.env.TUTTI_APP_RUNTIME_DIR || join(projectRoot, ".tutti", "runtime");
const dataDir = process.env.TUTTI_APP_DATA_DIR || join(projectRoot, ".tutti", "data");
const baseUrl = process.env.TUTTI_APP_BASE_URL || `http://${host}:${port}`;

const baseEnv = {
  ...process.env,
  HOST: host,
  PORT: port,
  GROUP_CHAT_HOME: dataDir,
  GROUP_CHAT_RUNTIME_DIR: runtimeDir,
  GROUP_CHAT_WEB_DIST: webDist,
  GROUP_CHAT_SERVER_URL: baseUrl,
  GROUP_CHAT_TOOL_BASE_URL: baseUrl,
  GROUP_CHAT_WORKSPACE_ROOT: process.env.TUTTI_WORKSPACE_ROOT || projectRoot,
};

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || projectRoot,
      env: options.env || baseEnv,
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${signal || code}`));
    });
  });
}

async function buildStaticFrontend() {
  await run(nodeBin, [tscBin, "-p", "tsconfig.json"], {
    cwd: join(projectRoot, "packages", "shared"),
  });
  await run(nodeBin, [tscBin, "-p", "tsconfig.json", "--noEmit"], {
    cwd: join(projectRoot, "apps", "web"),
  });
  await run(nodeBin, [viteBin, "build"], {
    cwd: join(projectRoot, "apps", "web"),
    env: {
      ...baseEnv,
      VITE_API_TARGET: baseUrl,
    },
  });
}

async function startServer() {
  const child = spawn(nodeBin, [tsxBin, "watch", "src/main.ts"], {
    cwd: join(projectRoot, "apps", "server"),
    env: baseEnv,
    stdio: "inherit",
    shell: false,
  });

  const stop = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  await new Promise((resolvePromise, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal || code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`server exited with code ${code}`));
    });
  });
}

try {
  console.log(`[group-chat-dev] project root: ${projectRoot}`);
  console.log(`[group-chat-dev] binding ${host}:${port}`);
  await buildStaticFrontend();
  await startServer();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
