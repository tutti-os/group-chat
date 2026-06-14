import type {
  Artifact,
  Conversation,
  Identity,
  LocalAgentProviderStatus,
  Message,
  Participant,
  RuntimeProfile,
} from "@group-chat/shared";

export interface RuntimeReplyContext {
  runId?: string;
  toolAccess?: {
    token: string;
    expiresAt: string;
  };
  conversation: Conversation;
  participant: Participant;
  identity: Identity | null;
  runtimeProfile: RuntimeProfile | null;
  userMessage: Message;
  recentMessages: Message[];
  attachments: Artifact[];
}

export interface RuntimeRunDescriptor {
  runtime: string;
  provider: string;
  model: string;
}

export type RuntimeStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input?: unknown }
  | {
      type: "tool_result";
      id: string;
      name?: string;
      status?: "completed" | "failed";
      output?: unknown;
      summary?: string;
      error?: string;
      isError?: boolean;
    }
  | { type: "status"; message?: string; status?: string }
  | { type: "file_write"; path: string }
  | { type: "stderr"; text: string };

export interface RuntimeProvider {
  id: string;
  canHandle(runtimeProfile: RuntimeProfile | null): boolean;
  describeRun(context: RuntimeReplyContext): RuntimeRunDescriptor;
  detect(context: RuntimeReplyContext): Promise<{ available: boolean; reason?: string }>;
  listLocalAgentProviders?(): Promise<LocalAgentProviderStatus[]>;
  streamReply(context: RuntimeReplyContext): AsyncIterable<string | RuntimeStreamEvent>;
  cancel(runId: string): Promise<{ cancelled: boolean; reason?: string }>;
}

export class RuntimeProviderUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeProviderUnsupportedError";
  }
}
