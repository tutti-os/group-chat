import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface LocalAgentContextWindowUsage {
  usedTokens: number;
  totalTokens: number;
  percentUsed: number;
}

export interface StoredLocalAgentSession {
  agentTargetId?: string;
  provider: string;
  providerSessionId?: string;
  resumeToken?: string;
  model: string | null;
  usage?: unknown;
  contextWindow?: LocalAgentContextWindowUsage | null;
  usageUpdatedAt?: string | null;
  compactedAt?: string | null;
  updatedAt: string;
}

export class LocalAgentSessionStore {
  constructor(private readonly workspaceRoot: string) {}

  read(conversationId: string): StoredLocalAgentSession | null {
    try {
      const parsed = JSON.parse(readFileSync(this.pathFor(conversationId), "utf8")) as StoredLocalAgentSession;
      return typeof parsed.provider === "string" && parsed.provider ? parsed : null;
    } catch {
      return null;
    }
  }

  write(conversationId: string, session: Omit<StoredLocalAgentSession, "updatedAt">) {
    const existing = this.read(conversationId);
    const filePath = this.pathFor(conversationId);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(
      filePath,
      `${JSON.stringify(
        {
          ...existing,
          ...session,
          usage: session.usage ?? existing?.usage,
          contextWindow: session.contextWindow ?? existing?.contextWindow ?? null,
          usageUpdatedAt: session.usageUpdatedAt ?? existing?.usageUpdatedAt ?? null,
          compactedAt: session.compactedAt ?? existing?.compactedAt ?? null,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  updateUsage(
    conversationId: string,
    input: {
      agentTargetId: string;
      provider: string;
      model: string | null;
      usage: unknown;
    },
  ) {
    const contextWindow = extractContextWindowUsage(input.usage);
    this.write(conversationId, {
      provider: input.provider,
      agentTargetId: input.agentTargetId,
      model: input.model,
      usage: input.usage,
      contextWindow,
      usageUpdatedAt: new Date().toISOString(),
    });
  }

  markCompacted(conversationId: string, input: { agentTargetId: string; provider: string; model: string | null }) {
    this.write(conversationId, {
      provider: input.provider,
      agentTargetId: input.agentTargetId,
      model: input.model,
      compactedAt: new Date().toISOString(),
    });
  }

  remove(conversationId: string) {
    try {
      unlinkSync(this.pathFor(conversationId));
    } catch {
      // A missing session file is already equivalent to a fresh run.
    }
  }

  private pathFor(conversationId: string) {
    return join(this.workspaceRoot, ".group-chat", "local-agent-sessions", `${safePathSegment(conversationId)}.json`);
  }
}

export function extractContextWindowUsage(usage: unknown): LocalAgentContextWindowUsage | null {
  const usageRecord = toRecord(usage);
  if (!usageRecord) return null;
  const contextWindow = toRecord(usageRecord.contextWindow)
    ?? toRecord(usageRecord.context_window)
    ?? (usageRecord.usedTokens !== undefined || usageRecord.used !== undefined || usageRecord.totalTokens !== undefined || usageRecord.size !== undefined
      ? usageRecord
      : null);
  const usedTokens = finiteNumber(contextWindow?.usedTokens)
    ?? finiteNumber(contextWindow?.used_tokens)
    ?? finiteNumber(contextWindow?.used);
  const totalTokens = finiteNumber(contextWindow?.totalTokens)
    ?? finiteNumber(contextWindow?.total_tokens)
    ?? finiteNumber(contextWindow?.size);
  if (usedTokens === null || totalTokens === null || totalTokens <= 0) {
    const codexTokenUsage = extractCodexTokenUsage(usageRecord);
    if (codexTokenUsage) return codexTokenUsage;
    return null;
  }
  return {
    usedTokens,
    totalTokens,
    percentUsed: Math.min(100, Math.max(0, Math.round((usedTokens / totalTokens) * 100))),
  };
}

function extractCodexTokenUsage(usageRecord: Record<string, unknown>): LocalAgentContextWindowUsage | null {
  const tokenUsage = toRecord(usageRecord.tokenUsage) ?? usageRecord;
  const last = toRecord(tokenUsage.last);
  const total = toRecord(tokenUsage.total);
  const usedTokens = finiteNumber(last?.totalTokens)
    ?? finiteNumber(last?.total_tokens)
    ?? finiteNumber(total?.totalTokens)
    ?? finiteNumber(total?.total_tokens);
  const totalTokens = finiteNumber(tokenUsage.modelContextWindow)
    ?? finiteNumber(tokenUsage.model_context_window);
  if (usedTokens === null || totalTokens === null || totalTokens <= 0) return null;
  return {
    usedTokens,
    totalTokens,
    percentUsed: Math.min(100, Math.max(0, Math.round((usedTokens / totalTokens) * 100))),
  };
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safePathSegment(value: string) {
  return value.replace(/[^\w.-]/g, "_") || "unknown";
}
