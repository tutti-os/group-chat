import type { Artifact } from "@group-chat/shared";

export interface TuttiWorkspaceAppOpenFileRequest {
  mode?: "auto" | "preview" | "reveal";
  mtimeMs?: number | null;
  name?: string;
  path: string;
  sizeBytes?: number | null;
}

export interface TuttiWorkspaceAppBridge {
  files?: {
    open(input: TuttiWorkspaceAppOpenFileRequest): Promise<void>;
  };
  appContext?: TuttiWorkspaceAppContext;
}

export interface TuttiWorkspaceAppContext {
  get?(): Promise<{ workspaceId?: string; locale?: string; language?: string }>;
  getLocale?(): Promise<string>;
  subscribe?(listener: (context: { locale?: string; language?: string } | null) => void): () => void;
  onLocaleChanged?(listener: (locale: string) => void): () => void;
  locale?: string;
  language?: string;
}

export function readTuttiAppContextValue(): TuttiWorkspaceAppContext | null {
  if (typeof window === "undefined") return null;
  return window.tutti?.appContext ?? window.tuttiAppContext ?? null;
}

declare global {
  interface Window {
    tutti?: TuttiWorkspaceAppBridge;
    tuttiAppContext?: TuttiWorkspaceAppContext;
  }
}

export function isTuttiWorkspaceAppEnvironment() {
  return typeof window !== "undefined" && Boolean(window.tutti?.files?.open);
}

export async function tryOpenArtifactInTutti(artifact: Artifact): Promise<boolean> {
  const bridge = window.tutti;
  if (!bridge?.files?.open || !artifact.localPath?.trim()) {
    return false;
  }

  try {
    const context = bridge.appContext?.get ? await bridge.appContext.get() : null;
    if (!context?.workspaceId) {
      return false;
    }

    await bridge.files.open({
      path: artifact.localPath,
      name: artifact.filename,
      mtimeMs: Date.parse(artifact.createdAt),
      sizeBytes: artifact.sizeBytes,
      mode: "auto",
    });
    return true;
  } catch {
    return false;
  }
}
