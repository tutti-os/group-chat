import { randomBytes } from "node:crypto";

const DEFAULT_TTL_MS = 15 * 60 * 1000;

export interface AgentToolGrant {
  token: string;
  runId: string;
  participantId: string;
  conversationId: string;
  expiresAt: string;
}

export interface AgentToolCredential {
  token?: string | null;
}

export class AgentToolUnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentToolUnauthorizedError";
  }
}

export class AgentToolTokenStore {
  private readonly grants = new Map<string, AgentToolGrant>();

  issue(input: { runId: string; participantId: string; conversationId: string }) {
    this.pruneExpired();
    const token = randomBytes(24).toString("base64url");
    const grant: AgentToolGrant = {
      token,
      runId: input.runId,
      participantId: input.participantId,
      conversationId: input.conversationId,
      expiresAt: new Date(Date.now() + Number(process.env.GROUP_CHAT_TOOL_TOKEN_TTL_MS ?? DEFAULT_TTL_MS)).toISOString(),
    };
    this.grants.set(token, grant);
    return grant;
  }

  authorize(participantId: string, credential: AgentToolCredential) {
    this.pruneExpired();
    if (!credential.token) throw new AgentToolUnauthorizedError("Agent tool token is required");
    const grant = this.grants.get(credential.token);
    if (!grant) throw new AgentToolUnauthorizedError("Agent tool token is invalid or expired");
    if (grant.participantId !== participantId) {
      throw new AgentToolUnauthorizedError("Agent tool token does not match participant");
    }
    return grant;
  }

  revokeRun(runId: string) {
    for (const [token, grant] of this.grants.entries()) {
      if (grant.runId === runId) this.grants.delete(token);
    }
  }

  private pruneExpired() {
    const now = Date.now();
    for (const [token, grant] of this.grants.entries()) {
      if (Date.parse(grant.expiresAt) <= now) this.grants.delete(token);
    }
  }
}
