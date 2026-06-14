import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Conversation, Identity, Message, Participant } from "@group-chat/shared";
import { identityWorkspaceRoot, participantWorkspaceRoot } from "../local/paths.js";
import {
  buildAgentInstructions,
  buildEffectiveRoleDescription,
  buildRoleDescription,
  hasRoomRoleOverride,
} from "./agent-instructions.js";

const DISTILLED_CONTEXT_FILENAME = "DISTILLED_CONTEXT.md";
const RAW_CONVERSATION_MAX_CHARS = 80000;
const RAW_CONVERSATION_KEEP_CHARS = 52000;
const DIGEST_RECENT_TURNS = 12;
const GENERATED_SECTION_START = "<!-- group-chat:generated-memory:start -->";
const GENERATED_SECTION_END = "<!-- group-chat:generated-memory:end -->";

export class AgentWorkspaceService {
  materializeIdentity(identity: Identity) {
    const root = identityWorkspaceRoot(identity.id);
    mkdirSync(root, { recursive: true });
    writeGeneratedFile(join(root, "IDENTITY.md"), buildIdentityFile(identity));
    writeGeneratedFile(join(root, "SOUL.md"), buildSoulFile(identity));
    writeIfMissing(join(root, "MEMORY.md"), "# Memory\n\nNo long-term memory recorded yet.\n");
    writeIfMissing(join(root, DISTILLED_CONTEXT_FILENAME), buildEmptyDistilledContext(identity.name));
    return { root };
  }

  materializeParticipant(input: { conversation: Conversation; participant: Participant; identity: Identity | null }) {
    const root = participantWorkspaceRoot(input.conversation.roomId, input.participant.id);
    mkdirSync(join(root, "memory", "users"), { recursive: true });
    mkdirSync(join(root, "skills"), { recursive: true });
    mkdirSync(join(root, "conversations"), { recursive: true });

    const agentInstructions = buildAgentInstructions(input);
    writeGeneratedFile(join(root, "AGENTS.md"), agentInstructions);
    writeGeneratedFile(join(root, "BOOTSTRAP.md"), buildBootstrapFile(input));
    writeGeneratedFile(join(root, "IDENTITY.md"), buildParticipantIdentityFile(input));
    writeGeneratedFile(join(root, "SOUL.md"), buildParticipantSoulFile(input));
    writeIfMissing(join(root, "OWNER.md"), "# Owner\n\nThis workspace is owned by the local group-chat user.\n");
    writeIfMissing(join(root, "MEMORY.md"), "# Memory\n\nNo room-scoped memory recorded yet.\n");
    writeIfMissing(join(root, DISTILLED_CONTEXT_FILENAME), buildEmptyDistilledContext(input.participant.displayName));
    ensureClaudeAlias(root, agentInstructions);
    return { root };
  }

  recordInteractionMemory(input: {
    conversation: Conversation;
    participant: Participant;
    userMessage: Message;
    assistantMessage: Message;
  }) {
    const root = participantWorkspaceRoot(input.conversation.roomId, input.participant.id);
    mkdirSync(join(root, "memory", "users"), { recursive: true });
    mkdirSync(join(root, "conversations"), { recursive: true });
    writeIfMissing(join(root, "MEMORY.md"), "# Memory\n\nNo room-scoped memory recorded yet.\n");
    writeIfMissing(join(root, "memory", "users", "local-user.md"), "# Local User Memory\n\nNo user memory recorded yet.\n");

    const entry = buildMemoryEntry(input);
    const conversationLogPath = join(root, "conversations", `${input.conversation.id}.md`);
    appendCompactedConversationEntry(conversationLogPath, entry);
    const rawConversationLog = readTextFile(conversationLogPath);
    const recentEntries = parseRecentMemoryEntries(rawConversationLog, DIGEST_RECENT_TURNS);
    const digest = buildDistilledContext({
      ...input,
      recentEntries,
      rawConversationLog,
    });
    const userDigest = buildLocalUserDigest(input, recentEntries);
    writeGeneratedSection(join(root, "MEMORY.md"), digest);
    writeGeneratedSection(join(root, "memory", "users", "local-user.md"), userDigest);
    writeGeneratedFile(join(root, "conversations", `${input.conversation.id}.summary.md`), buildConversationSummary(input, recentEntries));
    writeGeneratedFile(join(root, DISTILLED_CONTEXT_FILENAME), digest);
  }
}

function buildIdentityFile(identity: Identity) {
  return [
    "# Identity",
    "",
    `- ID: ${identity.id}`,
    `- Name: ${identity.name}`,
    `- Icon: ${identity.icon}`,
    identity.defaultRuntimeProfileId ? `- Default runtime profile: ${identity.defaultRuntimeProfileId}` : null,
    `- Temperature: ${identity.temperature}`,
    "",
    "## System Prompt",
    identity.systemPrompt.trim() || "No system prompt configured.",
    "",
    "## Style Prompt",
    identity.stylePrompt.trim() || "No style prompt configured.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function buildParticipantIdentityFile(input: {
  conversation: Conversation;
  participant: Participant;
  identity: Identity | null;
}) {
  return [
    "# Participant Identity",
    "",
    `- Participant ID: ${input.participant.id}`,
    `- Display name: ${input.participant.displayName}`,
    `- Conversation ID: ${input.conversation.id}`,
    `- Room ID: ${input.conversation.roomId}`,
    input.participant.runtimeProfileId ? `- Runtime profile: ${input.participant.runtimeProfileId}` : null,
    `- Listen mode: ${input.participant.listenMode}`,
    input.participant.reasoningEffort ? `- Reasoning effort: ${input.participant.reasoningEffort}` : null,
    input.identity ? `- Identity ID: ${input.identity.id}` : null,
    input.identity ? `- Identity name: ${input.identity.name}` : null,
    hasRoomRoleOverride(input.participant)
      ? "This participant uses a room-specific role description that overrides the global identity defaults in this room only."
      : null,
    "",
    "## Role Description",
    buildEffectiveRoleDescription(input.participant, input.identity) || "No role description configured.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function buildSoulFile(identity: Identity | null) {
  return [
    "# Soul",
    "",
    "This file captures the stable personality material that should survive runtime restarts.",
    "",
    buildRoleDescription(identity) || "No stable personality configured yet.",
  ].join("\n");
}

function buildParticipantSoulFile(input: { participant: Participant; identity: Identity | null }) {
  return [
    "# Soul",
    "",
    "This file captures the stable personality material that should survive runtime restarts.",
    "",
    buildEffectiveRoleDescription(input.participant, input.identity) || "No stable personality configured yet.",
  ].join("\n");
}

function buildBootstrapFile(input: { conversation: Conversation; participant: Participant; identity: Identity | null }) {
  return [
    "# Bootstrap",
    "",
    `Read AGENTS.md first. Treat IDENTITY.md, SOUL.md, MEMORY.md, and ${DISTILLED_CONTEXT_FILENAME} as room-scoped operating context.`,
    "",
    "## Current Room",
    `- Title: ${input.conversation.title}`,
    input.conversation.groupSystemPrompt ? `- Context: ${input.conversation.groupSystemPrompt}` : null,
    input.conversation.collaborationRules
      ? `- Collaboration rules version: ${input.conversation.collaborationRulesVersion}`
      : null,
    input.conversation.collaborationRules ? "" : null,
    input.conversation.collaborationRules ? "## Collaboration Rules" : null,
    input.conversation.collaborationRules ? input.conversation.collaborationRules : null,
    "",
    "## Current Participant",
    `- Display name: ${input.participant.displayName}`,
    `- Listen mode: ${input.participant.listenMode}`,
    input.identity ? `- Identity: ${input.identity.name}` : null,
    hasRoomRoleOverride(input.participant)
      ? `- Role override: room-specific description is active for this participant.`
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function writeGeneratedFile(path: string, content: string) {
  writeFileSync(path, `${content.trimEnd()}\n`, "utf8");
}

function writeIfMissing(path: string, content: string) {
  if (existsSync(path)) return;
  writeGeneratedFile(path, content);
}

function buildMemoryEntry(input: {
  conversation: Conversation;
  participant: Participant;
  userMessage: Message;
  assistantMessage: Message;
}) {
  return [
    "",
    `## ${input.assistantMessage.updatedAt}`,
    "",
    `- Conversation: ${input.conversation.title} (${input.conversation.id})`,
    `- Participant: ${input.participant.displayName} (${input.participant.id})`,
    `- User message: ${input.userMessage.id}`,
    `- Assistant message: ${input.assistantMessage.id}`,
    "",
    "### User",
    truncateForMemory(redactText(input.userMessage.content)),
    "",
    "### Assistant",
    truncateForMemory(redactText(input.assistantMessage.content)),
    "",
  ].join("\n");
}

function truncateForMemory(text: string) {
  const normalized = text.trim();
  if (!normalized) return "(empty)";
  return normalized.length > 1200 ? `${normalized.slice(0, 1200)}...` : normalized;
}

function buildEmptyDistilledContext(agentName: string) {
  return [
    "# Distilled Context",
    "",
    `No distilled memory has been recorded for ${agentName || "this agent"} yet.`,
    "",
    "When conversations complete, group-chat updates this file with compact room memory, user signals, and recent turns.",
  ].join("\n");
}

function appendCompactedConversationEntry(path: string, entry: string) {
  appendFileSync(path, entry, "utf8");
  const raw = readTextFile(path);
  if (raw.length <= RAW_CONVERSATION_MAX_CHARS) return;
  const kept = keepRecentConversationSections(raw, RAW_CONVERSATION_KEEP_CHARS);
  writeGeneratedFile(
    path,
    [
      "# Compacted Conversation Log",
      "",
      `Older raw entries were compacted after this file exceeded ${RAW_CONVERSATION_MAX_CHARS} characters.`,
      "Use the sibling .summary.md file and DISTILLED_CONTEXT.md for durable context.",
      "",
      kept.trim(),
    ].join("\n"),
  );
}

function keepRecentConversationSections(raw: string, keepChars: number) {
  const tail = raw.slice(Math.max(0, raw.length - keepChars));
  const boundary = tail.search(/\n## \d{4}-\d{2}-\d{2}T/);
  return boundary >= 0 ? tail.slice(boundary + 1) : tail;
}

function parseRecentMemoryEntries(raw: string, limit: number): ParsedMemoryEntry[] {
  const sections = raw
    .split(/\n(?=## \d{4}-\d{2}-\d{2}T)/)
    .map((section) => section.trim())
    .filter((section) => section.startsWith("## "));
  return sections.slice(-limit).map(parseMemoryEntry);
}

interface ParsedMemoryEntry {
  timestamp: string;
  conversationLine: string;
  participantLine: string;
  userText: string;
  assistantText: string;
}

function parseMemoryEntry(section: string): ParsedMemoryEntry {
  return {
    timestamp: section.match(/^##\s+(.+)$/m)?.[1]?.trim() ?? "unknown",
    conversationLine: section.match(/^- Conversation:\s+(.+)$/m)?.[1]?.trim() ?? "unknown conversation",
    participantLine: section.match(/^- Participant:\s+(.+)$/m)?.[1]?.trim() ?? "unknown participant",
    userText: section.match(/### User\n([\s\S]*?)\n\n### Assistant/)?.[1]?.trim() ?? "",
    assistantText: section.match(/### Assistant\n([\s\S]*)$/)?.[1]?.trim() ?? "",
  };
}

function buildDistilledContext(input: {
  conversation: Conversation;
  participant: Participant;
  userMessage: Message;
  assistantMessage: Message;
  recentEntries: ParsedMemoryEntry[];
  rawConversationLog: string;
}) {
  const userSignals = extractUserSignals(input.recentEntries.map((entry) => entry.userText));
  const recentTurns = input.recentEntries.slice(-6).map(renderRecentTurn);
  return [
    "# Distilled Context",
    "",
    `Last updated: ${input.assistantMessage.updatedAt}`,
    `Conversation: ${input.conversation.title} (${input.conversation.id})`,
    `Participant: ${input.participant.displayName} (${input.participant.id})`,
    "",
    "## How To Use This File",
    "- Treat this as compact memory, not as a replacement for AGENTS.md or collaboration rules.",
    "- Prefer explicit room rules and direct user messages over older memory when they conflict.",
    "- Use conversations/*.md for raw recent turns and conversations/*.summary.md for conversation-specific digest.",
    "",
    "## User Signals",
    userSignals.length > 0 ? userSignals.map((signal) => `- ${signal}`).join("\n") : "- No stable user preference has been extracted yet.",
    "",
    "## Recent Conversation Digest",
    recentTurns.length > 0 ? recentTurns.join("\n") : "- No recent turns recorded yet.",
    "",
    "## Memory Budget",
    `- Raw conversation log chars: ${input.rawConversationLog.length}`,
    `- Recent turns represented here: ${input.recentEntries.length}`,
    `- Raw logs compact after ${RAW_CONVERSATION_MAX_CHARS} chars, keeping the latest ${RAW_CONVERSATION_KEEP_CHARS} chars.`,
  ].join("\n");
}

function buildLocalUserDigest(input: {
  conversation: Conversation;
  participant: Participant;
  assistantMessage: Message;
}, recentEntries: ParsedMemoryEntry[]) {
  const signals = extractUserSignals(recentEntries.map((entry) => entry.userText));
  return [
    "# Local User Memory",
    "",
    `Last updated: ${input.assistantMessage.updatedAt}`,
    `Observed in conversation: ${input.conversation.title} (${input.conversation.id})`,
    `Observed by participant: ${input.participant.displayName} (${input.participant.id})`,
    "",
    "## Extracted Signals",
    signals.length > 0 ? signals.map((signal) => `- ${signal}`).join("\n") : "- No stable user signal has been extracted yet.",
  ].join("\n");
}

function buildConversationSummary(input: {
  conversation: Conversation;
  participant: Participant;
  assistantMessage: Message;
}, recentEntries: ParsedMemoryEntry[]) {
  return [
    "# Conversation Summary",
    "",
    `Conversation: ${input.conversation.title} (${input.conversation.id})`,
    `Last updated: ${input.assistantMessage.updatedAt}`,
    "",
    "## Recent Turns",
    recentEntries.length > 0 ? recentEntries.map(renderRecentTurn).join("\n") : "- No turns recorded yet.",
  ].join("\n");
}

function renderRecentTurn(entry: ParsedMemoryEntry) {
  const user = compactInline(entry.userText, 180);
  const assistant = compactInline(entry.assistantText, 220);
  return `- ${entry.timestamp}: user asked "${user}"; ${entry.participantLine} answered "${assistant}".`;
}

function extractUserSignals(texts: string[]) {
  const indicators = [
    /(^|[。.!?\n])\s*(我(?:希望|想|要|需要|偏好|喜欢|不喜欢|习惯|更倾向)|记住|以后|不要|别|必须|优先|prefer|preference|always|never|must|should)/i,
  ];
  const seen = new Set<string>();
  const signals: string[] = [];
  for (const text of texts) {
    for (const sentence of splitSentences(text)) {
      const compact = compactInline(sentence, 220);
      if (!compact || seen.has(compact)) continue;
      if (!indicators.some((rx) => rx.test(compact))) continue;
      seen.add(compact);
      signals.push(compact);
      if (signals.length >= 10) return signals;
    }
  }
  return signals;
}

function splitSentences(text: string) {
  return text
    .split(/(?<=[。！？.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function compactInline(text: string, max: number) {
  const compact = redactText(text).replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max)}...`;
}

function redactText(text: string) {
  return text
    .replace(/sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g, "[REDACTED:api-key]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[REDACTED:github-token]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED:aws-key]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED:jwt]")
    .replace(/\b(?:bearer|api[_-]?key|access[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9_.\-+/]{20,}["']?/gi, "[REDACTED:token]");
}

function writeGeneratedSection(path: string, generatedContent: string) {
  const existing = existsSync(path) ? readTextFile(path) : "";
  const section = `${GENERATED_SECTION_START}\n${generatedContent.trimEnd()}\n${GENERATED_SECTION_END}`;
  if (!existing.trim()) {
    writeGeneratedFile(path, section);
    return;
  }
  const pattern = new RegExp(`${escapeRegex(GENERATED_SECTION_START)}[\\s\\S]*?${escapeRegex(GENERATED_SECTION_END)}`);
  const next = pattern.test(existing)
    ? existing.replace(pattern, section)
    : `${existing.trimEnd()}\n\n${section}`;
  writeGeneratedFile(path, next);
}

function readTextFile(path: string) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ensureClaudeAlias(root: string, agentInstructions: string) {
  const target = join(root, "CLAUDE.md");
  if (existsSync(target)) {
    if (lstatSync(target).isSymbolicLink()) return;
    writeGeneratedFile(target, agentInstructions);
    return;
  }
  try {
    symlinkSync("AGENTS.md", target);
  } catch {
    writeGeneratedFile(target, agentInstructions);
  }
}
