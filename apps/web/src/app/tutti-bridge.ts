import type { Artifact, TuttiAtProviderId, TuttiReferenceInsert } from "@group-chat/shared";

export interface TuttiAtQueryResult {
  providerId: TuttiAtProviderId;
  itemId: string;
  label: string;
  subtitle?: string;
  thumbnailUrl?: string | null;
  insert: TuttiReferenceInsert;
}

export interface TuttiWorkspaceAppOpenFileRequest {
  mode?: "auto" | "preview" | "reveal";
  mtimeMs?: number | null;
  name?: string;
  path: string;
  sizeBytes?: number | null;
  location?: {
    type: "app-data-relative" | "app-package-relative" | "workspace-relative";
    path: string;
  };
}

export interface TuttiWorkspaceReferenceOpenRequest {
  href: string;
}

export interface TuttiWorkspaceAppContext {
  get?(): Promise<{ workspaceId?: string; locale?: string; language?: string }>;
  subscribe?(listener: (context: { workspaceId?: string; locale?: string; language?: string } | null) => void): () => void;
}

export function readTuttiAppContextValue(): TuttiWorkspaceAppContext | null {
  if (typeof window === "undefined") return null;
  const externalApp = window.tuttiExternal?.app;
  if (!externalApp) return null;
  return {
    async get() {
      return normalizeExternalAppContext(await externalApp.getContext());
    },
    subscribe(listener) {
      return externalApp.subscribe((context) => {
        listener(normalizeExternalAppContext(context));
      });
    },
  };
}

declare global {
  interface Window {
    tuttiExternal?: {
      app?: {
        getContext(): Promise<unknown>;
        subscribe(listener: (context: unknown) => void): () => void;
      };
      at?: {
        query(input: {
          keyword: string;
          maxResults?: number;
          providers?: readonly TuttiAtProviderId[];
        }): Promise<readonly TuttiAtQueryResult[]>;
      };
      files?: {
        open(input: TuttiWorkspaceAppOpenFileRequest): Promise<void>;
      };
      references?: {
        open(input: TuttiWorkspaceReferenceOpenRequest): Promise<void>;
      };
    };
  }
}

export function isTuttiWorkspaceAppEnvironment() {
  return typeof window !== "undefined" && Boolean(window.tuttiExternal?.app);
}

export function extractAppDataRelativePath(localPath: string): string | null {
  const normalized = localPath.replace(/\\/g, "/").trim();
  if (!normalized) return null;

  const tuttiWorkspaceMatch = normalized.match(/\/apps\/workspaces\/[^/]+\/[^/]+\/data\/(.+)$/);
  if (tuttiWorkspaceMatch?.[1]) return tuttiWorkspaceMatch[1];

  const groupChatDataMatch = normalized.match(/\/group-chat\/data\/(.+)$/);
  if (groupChatDataMatch?.[1]) return groupChatDataMatch[1];

  const localHomeMatch = normalized.match(/\/\.group-chat\/(.+)$/);
  if (localHomeMatch?.[1] && !localHomeMatch[1].includes("..")) return localHomeMatch[1];

  return null;
}

export function buildTuttiOpenFileRequest(
  artifact: Pick<Artifact, "localPath" | "filename" | "createdAt" | "sizeBytes">,
  mode: TuttiWorkspaceAppOpenFileRequest["mode"] = "reveal",
): TuttiWorkspaceAppOpenFileRequest | null {
  const relativePath = extractAppDataRelativePath(artifact.localPath);
  if (relativePath) {
    return {
      path: relativePath,
      location: { type: "app-data-relative", path: relativePath },
      name: artifact.filename,
      mtimeMs: Date.parse(artifact.createdAt),
      sizeBytes: artifact.sizeBytes,
      mode,
    };
  }

  const absolutePath = artifact.localPath?.trim();
  if (!absolutePath) return null;

  return {
    path: absolutePath,
    name: artifact.filename,
    mtimeMs: Date.parse(artifact.createdAt),
    sizeBytes: artifact.sizeBytes,
    mode,
  };
}

export function tryOpenFileInTuttiSync(input: TuttiWorkspaceAppOpenFileRequest): boolean {
  const bridge = window.tuttiExternal;
  if (!bridge?.files?.open) {
    return false;
  }

  try {
    void bridge.files.open(input);
    return true;
  } catch {
    return false;
  }
}

export async function tryOpenFileInTutti(
  input: TuttiWorkspaceAppOpenFileRequest,
): Promise<boolean> {
  if (tryOpenFileInTuttiSync(input)) {
    return true;
  }
  return false;
}

export function tryOpenReferenceInTuttiSync(input: TuttiWorkspaceReferenceOpenRequest): boolean {
  const bridge = window.tuttiExternal;
  if (!bridge?.references?.open) {
    return false;
  }

  try {
    void bridge.references.open(input);
    return true;
  } catch {
    return false;
  }
}

export function tryOpenReferenceHrefInTuttiSync(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed.startsWith("mention://")) return false;
  return tryOpenReferenceInTuttiSync({ href: trimmed });
}

export type OpenableTuttiReferenceProvider = "workspace-app" | "workspace-issue" | "agent-session";

export function isOpenableTuttiReferenceProvider(providerId: string): providerId is OpenableTuttiReferenceProvider {
  return providerId === "workspace-app" || providerId === "workspace-issue" || providerId === "agent-session";
}

export function resolveReferenceMentionScope(
  referenceInsert?: TuttiReferenceInsert,
  referenceScope?: Readonly<Record<string, string>>,
) {
  if (referenceInsert?.kind === "mention" && referenceInsert.scope) {
    return referenceInsert.scope;
  }
  return referenceScope;
}

let cachedTuttiWorkspaceId: string | null = null;

export function readCachedTuttiWorkspaceId() {
  return cachedTuttiWorkspaceId;
}

export function initTuttiWorkspaceContextCache() {
  const context = readTuttiAppContextValue();
  if (!context?.get) return () => {};
  void context.get().then((value) => {
    cachedTuttiWorkspaceId = value.workspaceId?.trim() || null;
  });
  const unsubscribe = context.subscribe?.((value) => {
    cachedTuttiWorkspaceId = value?.workspaceId?.trim() || null;
  });
  return unsubscribe ?? (() => {});
}

export function buildTuttiMentionHref(
  providerId: OpenableTuttiReferenceProvider,
  entityId: string,
  options?: {
    referenceInsert?: TuttiReferenceInsert;
    referenceScope?: Readonly<Record<string, string>>;
    workspaceId?: string | null;
  },
) {
  const scope = resolveReferenceMentionScope(options?.referenceInsert, options?.referenceScope);
  const workspaceId = options?.workspaceId?.trim() || scope?.workspaceId?.trim() || readCachedTuttiWorkspaceId();
  const normalizedEntityId = entityId.trim();
  if (!workspaceId || !normalizedEntityId) return null;

  const url = new URL(`mention://${providerId}/${encodeURIComponent(normalizedEntityId)}`);
  url.searchParams.set("workspaceId", workspaceId);
  if (providerId === "agent-session" && scope?.provider?.trim()) {
    url.searchParams.set("provider", scope.provider.trim());
  }
  if (providerId === "workspace-issue") {
    for (const key of ["mode", "outputDir", "runId", "taskId", "topicId"] as const) {
      const value = scope?.[key]?.trim();
      if (value) url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export async function tryOpenTuttiReferenceMention(
  providerId: OpenableTuttiReferenceProvider,
  entityId: string,
  options?: {
    referenceInsert?: TuttiReferenceInsert;
    referenceScope?: Readonly<Record<string, string>>;
  },
) {
  const href = buildTuttiMentionHref(providerId, entityId, options);
  if (href && tryOpenReferenceHrefInTuttiSync(href)) {
    return true;
  }

  const context = readTuttiAppContextValue();
  if (!context?.get) {
    return false;
  }
  const workspaceId = (await context.get())?.workspaceId;
  const fallbackHref = buildTuttiMentionHref(providerId, entityId, {
    ...options,
    workspaceId,
  });
  if (fallbackHref && tryOpenReferenceHrefInTuttiSync(fallbackHref)) {
    return true;
  }
  return false;
}

export function tryOpenArtifactInTuttiSync(
  artifact: Artifact,
  mode: TuttiWorkspaceAppOpenFileRequest["mode"] = "reveal",
): boolean {
  const request = buildTuttiOpenFileRequest(artifact, mode);
  if (!request) return false;
  return tryOpenFileInTuttiSync(request);
}

export async function tryOpenArtifactInTutti(
  artifact: Artifact,
  mode: TuttiWorkspaceAppOpenFileRequest["mode"] = "reveal",
): Promise<boolean> {
  return tryOpenArtifactInTuttiSync(artifact, mode);
}

function normalizeExternalAppContext(
  context: unknown,
): { workspaceId?: string; locale?: string; language?: string } {
  if (!context || typeof context !== "object") return {};
  const record = context as Record<string, unknown>;
  return {
    ...(typeof record.workspaceId === "string" ? { workspaceId: record.workspaceId } : {}),
    ...(typeof record.locale === "string" ? { locale: record.locale } : {}),
    ...(typeof record.language === "string" ? { language: record.language } : {}),
  };
}
