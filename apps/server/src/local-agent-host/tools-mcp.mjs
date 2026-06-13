#!/usr/bin/env node
import { createInterface } from "node:readline";

const baseUrl = process.env.GROUP_CHAT_TOOL_BASE_URL ?? "http://127.0.0.1:8788";
const participantId = requiredEnv("GROUP_CHAT_PARTICIPANT_ID");
const token = requiredEnv("GROUP_CHAT_TOOL_TOKEN");

const tools = [
  {
    name: "group_chat_get_context",
    description: "Read the current group-chat room context, participants, recent messages, artifacts, and active run metadata.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "group_chat_send_message",
    description: "Send a finalized assistant message to the current conversation as this agent participant.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string" },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
  {
    name: "group_chat_get_artifact",
    description: "Read a referenced artifact by id. Use this after group_chat_get_context or attachment metadata gives you an artifact id.",
    inputSchema: {
      type: "object",
      properties: {
        artifactId: { type: "string" },
      },
      required: ["artifactId"],
      additionalProperties: false,
    },
  },
  {
    name: "group_chat_save_artifact",
    description: "Save a generated artifact for the current conversation and bind it to the active run.",
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string" },
        mimeType: { type: "string" },
        contentBase64: { type: "string" },
        textPreview: { type: "string" },
        messageId: { type: "string" },
      },
      required: ["filename", "mimeType", "contentBase64"],
      additionalProperties: false,
    },
  },
];

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request;
  try {
    request = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (request.id === undefined || typeof request.method !== "string") return;
  try {
    const result = await handleRequest(request.method, request.params ?? {});
    write({ jsonrpc: "2.0", id: request.id, result });
  } catch (error) {
    write({
      jsonrpc: "2.0",
      id: request.id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
});

async function handleRequest(method, params) {
  if (method === "initialize") {
    return {
      protocolVersion: params.protocolVersion ?? "2024-11-05",
      serverInfo: {
        name: "group-chat-tools",
        version: "0.1.0",
      },
      capabilities: {
        tools: {},
      },
    };
  }
  if (method === "tools/list") {
    return { tools };
  }
  if (method === "tools/call") {
    return callTool(String(params.name ?? ""), params.arguments ?? {});
  }
  if (method === "ping") return {};
  throw new Error(`Unsupported MCP method: ${method}`);
}

async function callTool(name, args) {
  if (name === "group_chat_get_context") {
    return toolResult(await requestJson("GET", toolUrl("context")));
  }
  if (name === "group_chat_send_message") {
    return toolResult(
      await requestJson("POST", toolUrl("messages"), {
        content: requiredString(args.content, "content"),
      }),
    );
  }
  if (name === "group_chat_get_artifact") {
    return toolResult(await requestJson("GET", toolUrl(`artifacts/${encodeURIComponent(requiredString(args.artifactId, "artifactId"))}`)));
  }
  if (name === "group_chat_save_artifact") {
    return toolResult(
      await requestJson("POST", toolUrl("artifacts"), {
        filename: requiredString(args.filename, "filename"),
        mimeType: requiredString(args.mimeType, "mimeType"),
        contentBase64: requiredString(args.contentBase64, "contentBase64"),
        textPreview: typeof args.textPreview === "string" ? args.textPreview : undefined,
        messageId: typeof args.messageId === "string" ? args.messageId : undefined,
      }),
    );
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function requestJson(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      "x-group-chat-tool-token": token,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { text };
  }
  if (!response.ok) {
    throw new Error(`group-chat tool gateway ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function toolUrl(route) {
  return `${baseUrl}/api/agent-tools/participants/${encodeURIComponent(participantId)}/${route}`;
}

function toolResult(data) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
