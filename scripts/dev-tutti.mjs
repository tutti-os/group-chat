import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createManifest, packageTuttiApp, sha256File } from "./package-tutti-app.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), "..");
const buildRoot = path.join(rootDir, "build", "tutti-app");
const devStatePath = path.join(buildRoot, "dev-state.json");
const catalogPath = path.join(buildRoot, "dev-catalog.json");
const servePidPath = path.join(buildRoot, ".serve.pid");

const APP_ID = "group-chat";
const DEV_ZIP_NAME = "group-chat-dev.zip";
const DEFAULT_SERVE_PORT = 19_999;
const DEFAULT_TUTTI_ROOT = "/Users/zengtan/Desktop/code/tutti";

function log(message) {
  console.log(`[dev-tutti] ${message}`);
}

function fail(message) {
  console.error(`[dev-tutti] ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? rootDir,
      env: { ...process.env, ...options.env },
      stdio: options.stdio ?? "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readSourceBaseVersion() {
  const manifest = await readJson(path.join(rootDir, "tutti.app.json"));
  return String(manifest.version ?? "0.0.0").trim();
}

async function readDevState() {
  try {
    return await readJson(devStatePath);
  } catch {
    const baseVersion = await readSourceBaseVersion();
    return {
      baseVersion,
      devCounter: 0,
      version: `${baseVersion}-dev.0`,
    };
  }
}

async function nextDevVersion({ bump = true } = {}) {
  const state = await readDevState();
  const baseVersion = await readSourceBaseVersion();
  state.baseVersion = baseVersion;
  if (bump) {
    state.devCounter = Number(state.devCounter ?? 0) + 1;
  }
  state.version = `${baseVersion}-dev.${state.devCounter}`;
  await writeJson(devStatePath, state);
  return state;
}

function resolveServePort() {
  const raw = process.env.GROUP_CHAT_TUTTI_DEV_PORT?.trim();
  const port = raw ? Number(raw) : DEFAULT_SERVE_PORT;
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    fail(`invalid GROUP_CHAT_TUTTI_DEV_PORT: ${raw ?? ""}`);
  }
  return port;
}

function resolveTuttiRoot() {
  return path.resolve(process.env.TUTTI_ROOT?.trim() || DEFAULT_TUTTI_ROOT);
}

function buildCatalog({ version, zipSha256, servePort }) {
  const baseUrl = `http://127.0.0.1:${servePort}`;
  return {
    schemaVersion: "tutti.app.catalog.v1",
    apps: [
      {
        manifest: createManifest({ version }),
        distribution: {
          kind: "remote",
          artifactUrl: `${baseUrl}/${DEV_ZIP_NAME}`,
          artifactSha256: zipSha256,
          iconUrl: `${baseUrl}/package/icon.png`,
        },
      },
    ],
  };
}

async function packageForDev({ bump = true } = {}) {
  const state = await nextDevVersion({ bump });
  log(`packaging ${APP_ID}@${state.version} ...`);

  const previousVersion = process.env.GROUP_CHAT_TUTTI_APP_VERSION;
  process.env.GROUP_CHAT_TUTTI_APP_VERSION = state.version;
  let result;
  try {
    result = await packageTuttiApp();
  } finally {
    if (previousVersion === undefined) {
      delete process.env.GROUP_CHAT_TUTTI_APP_VERSION;
    } else {
      process.env.GROUP_CHAT_TUTTI_APP_VERSION = previousVersion;
    }
  }

  const stableZipPath = path.join(buildRoot, DEV_ZIP_NAME);
  await copyFile(result.zipPath, stableZipPath);
  const zipSha256 = await sha256File(stableZipPath);

  const catalog = buildCatalog({
    version: state.version,
    zipSha256,
    servePort: resolveServePort(),
  });
  await writeJson(catalogPath, catalog);

  const summary = {
    version: state.version,
    catalogPath,
    stableZipPath,
    zipSha256,
    packageRoot: result.packageRoot,
    serveBaseUrl: `http://127.0.0.1:${resolveServePort()}`,
  };
  await writeJson(path.join(buildRoot, "dev-summary.json"), summary);

  log(`package ready: ${state.version}`);
  log(`catalog: ${catalogPath}`);
  log(`artifact: ${summary.serveBaseUrl}/${DEV_ZIP_NAME}`);
  return summary;
}

function contentTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".json":
      return "application/json";
    case ".png":
      return "image/png";
    case ".zip":
      return "application/zip";
    case ".sh":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopTuttiDevProcesses() {
  const patterns = [
    "make dev-gui",
    "electron-vite dev",
    "/tutti/apps/desktop/build/tuttid/tuttid",
    "/tutti/apps/desktop/node_modules/.bin/../electron-vite/bin/electron-vite.js dev",
  ];
  const killed = new Set();
  for (const pattern of patterns) {
    const result = spawnSync("pgrep", ["-f", pattern], { encoding: "utf8" });
    for (const line of (result.stdout ?? "").split("\n")) {
      const pid = Number.parseInt(line.trim(), 10);
      if (!Number.isFinite(pid) || killed.has(pid)) continue;
      try {
        process.kill(pid, "SIGTERM");
        killed.add(pid);
      } catch {
        // ignore
      }
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  for (const pid of killed) {
    if (!isProcessRunning(pid)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ignore
    }
  }
  log(`stopped ${killed.size} Tutti dev process(es)`);
  if (killed.size === 0) {
    log("no Tutti dev GUI processes found");
  }
}

async function readServePid() {
  try {
    const raw = (await readFile(servePidPath, "utf8")).trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function startServe() {
  const port = resolveServePort();
  const existingPid = await readServePid();
  if (existingPid && isProcessRunning(existingPid)) {
    log(`artifact server already running on :${port} (pid ${existingPid})`);
    return existingPid;
  }

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
      const filePath = path.resolve(buildRoot, relativePath);
      if (!filePath.startsWith(buildRoot)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        response.writeHead(404);
        response.end("Not Found");
        return;
      }
      response.writeHead(200, {
        "Content-Type": contentTypeFor(filePath),
        "Content-Length": fileStat.size,
        "Cache-Control": "no-store",
      });
      createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(404);
      response.end("Not Found");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  const pid = process.pid;
  await writeFile(servePidPath, `${pid}\n`);
  log(`artifact server listening on http://127.0.0.1:${port}/`);
  log(`serving directory: ${buildRoot}`);

  const shutdown = async () => {
    server.close();
    try {
      await writeFile(servePidPath, "");
    } catch {
      // ignore
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return pid;
}

async function ensureServeRunning() {
  const pid = await readServePid();
  if (pid && isProcessRunning(pid)) {
    log(`artifact server already running (pid ${pid})`);
    return pid;
  }

  const child = spawn(process.execPath, [scriptPath, "serve"], {
    cwd: rootDir,
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const runningPid = await readServePid();
    if (runningPid && isProcessRunning(runningPid)) {
      log(`artifact server started (pid ${runningPid})`);
      return runningPid;
    }
  }

  fail("artifact server failed to start");
}

function printReloadInstructions(summary) {
  console.log("");
  log("reload complete. In Tutti App Center:");
  log("1. Open App Center and refresh the catalog");
  log("2. Reinstall or update Group Chat if prompted");
  log(`3. Current dev version: ${summary.version}`);
  console.log("");
}

async function startTutti() {
  const tuttiRoot = resolveTuttiRoot();
  try {
    await access(path.join(tuttiRoot, "Makefile"));
  } catch {
    fail(`Tutti root not found: ${tuttiRoot}. Set TUTTI_ROOT if needed.`);
  }

  try {
    await access(catalogPath);
  } catch {
    await packageForDev({ bump: false });
  }

  await ensureServeRunning();

  const env = {
    ...process.env,
    TUTTI_ENV: "development",
    TUTTI_APP_CATALOG_FILE: catalogPath,
    TUTTI_APP_CATALOG_URL: "",
  };

  log(`starting Tutti from ${tuttiRoot}`);
  log(`TUTTI_APP_CATALOG_FILE=${catalogPath}`);

  await run("make", ["dev-gui"], {
    cwd: tuttiRoot,
    env,
  });
}

async function printStatus() {
  const summaryPath = path.join(buildRoot, "dev-summary.json");
  try {
    const summary = await readJson(summaryPath);
    log(`version: ${summary.version}`);
    log(`catalog: ${summary.catalogPath}`);
    log(`artifact: ${summary.serveBaseUrl}/${DEV_ZIP_NAME}`);
  } catch {
    log("no dev package yet. Run: pnpm dev:tutti");
  }
  const pid = await readServePid();
  log(`serve pid: ${pid && isProcessRunning(pid) ? pid : "not running"}`);
}

function printHelp() {
  console.log(`Usage:
  pnpm dev:tutti         # package, serve artifacts, start Tutti dev GUI
  pnpm dev:tutti:reload  # rebuild package and refresh local catalog
  pnpm dev:tutti:serve   # run local artifact HTTP server only
  pnpm dev:tutti:stop    # stop Tutti dev GUI / electron-vite / tuttid
  pnpm dev:tutti:status  # show current dev package status

Environment:
  TUTTI_ROOT                 Tutti repo path (default: ${DEFAULT_TUTTI_ROOT})
  GROUP_CHAT_TUTTI_DEV_PORT  Artifact server port (default: ${DEFAULT_SERVE_PORT})
`);
}

async function main() {
  const [command = "help"] = process.argv.slice(2);

  switch (command) {
    case "package":
      await packageForDev({ bump: true });
      break;
    case "serve":
      await mkdir(buildRoot, { recursive: true });
      await startServe();
      break;
    case "start":
      await startTutti();
      break;
    case "reload": {
      const summary = await packageForDev({ bump: true });
      await ensureServeRunning();
      printReloadInstructions(summary);
      break;
    }
    case "status":
      await printStatus();
      break;
    case "stop":
      await stopTuttiDevProcesses();
      break;
    default:
      printHelp();
      break;
  }
}

if (process.argv[1] === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
