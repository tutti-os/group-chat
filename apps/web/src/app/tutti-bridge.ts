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

export interface TuttiWorkspaceAppContext {
  get?(): Promise<{ workspaceId?: string; locale?: string; language?: string }>;
  subscribe?(listener: (context: { locale?: string; language?: string } | null) => void): () => void;
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
