#!/usr/bin/env node
import { spawn } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const providers = String(args.providers ?? "codex,claude")
  .split(",")
  .map((provider) => provider.trim())
  .filter(Boolean);
const includeRealLocalAgents = Boolean(args.realLocalAgents);
const skipLocalAgentDetect = Boolean(args.skipLocalAgentDetect);

const steps = [
  {
    name: "core flow",
    command: ["pnpm", "--filter", "@group-chat/server", "core:smoke"],
  },
  {
    name: "workspace materialization",
    command: ["pnpm", "--filter", "@group-chat/server", "workspace:smoke"],
  },
];

if (!skipLocalAgentDetect) {
  for (const provider of providers) {
    steps.push({
      name: `${provider} detect`,
      command: ["pnpm", "--filter", "@group-chat/server", "local-agent:smoke", "--", "--provider", provider, "--detect-only"],
    });
  }
}

if (includeRealLocalAgents) {
  for (const provider of providers) {
    steps.push({
      name: `${provider} real local-agent`,
      command: ["pnpm", "--filter", "@group-chat/server", "local-agent:smoke", "--", "--provider", provider],
    });
  }
}

const startedAt = Date.now();
for (const [index, step] of steps.entries()) {
  const label = `${index + 1}/${steps.length} ${step.name}`;
  log(`starting ${label}`);
  const code = await run(step.command);
  if (code !== 0) {
    log(`failed ${label} with exit code ${code}`);
    process.exit(code ?? 1);
  }
  log(`passed ${label}`);
}

log(`all smoke checks passed in ${Date.now() - startedAt}ms`);

function run(command) {
  return new Promise((resolve) => {
    let resolved = false;
    const child = spawn(command[0], command.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let outputTail = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";
    child.stdout?.on("data", (chunk) => {
      const text = String(chunk);
      outputTail = appendTail(outputTail, text);
      stdoutBuffer = printSmokeLines(stdoutBuffer + text, process.stdout);
    });
    child.stderr?.on("data", (chunk) => {
      const text = String(chunk);
      outputTail = appendTail(outputTail, text);
      stderrBuffer = printSmokeLines(stderrBuffer + text, process.stderr);
    });
    child.once("close", (code) => {
      if (code !== 0 && outputTail) {
        process.stderr.write("\n[smoke] failing command output tail:\n");
        process.stderr.write(outputTail);
        if (!outputTail.endsWith("\n")) process.stderr.write("\n");
      }
      if (!resolved) {
        resolved = true;
        resolve(code ?? 0);
      }
    });
    child.once("error", () => {
      if (!resolved) {
        resolved = true;
        resolve(1);
      }
    });
  });
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function log(message) {
  process.stdout.write(`[smoke] ${message}\n`);
}

function appendTail(current, next) {
  return (current + next).slice(-30000);
}

function printSmokeLines(buffer, stream) {
  const lines = buffer.split(/\n/);
  const remainder = lines.pop() ?? "";
  for (const line of lines) {
    if (isHighSignalLine(line)) {
      stream.write(`${line}\n`);
    }
  }
  return remainder;
}

function isHighSignalLine(line) {
  return /\[(core-flow-smoke|workspace-smoke|local-agent-smoke)\]/.test(line);
}
