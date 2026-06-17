import type { Artifact } from "@group-chat/shared";

export interface TuttiWorkspaceAppOpenFileRequest {
  mode?: "auto" | "preview" | "reveal";
  mtimeMs?: number | null;
  name?: string;
  path: string;
  sizeBytes?: number | null;
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
      files?: {
        open(input: TuttiWorkspaceAppOpenFileRequest): Promise<void>;
      };
    };
  }
}

export function isTuttiWorkspaceAppEnvironment() {
  return typeof window !== "undefined" && Boolean(window.tuttiExternal?.app);
}

export async function tryOpenArtifactInTutti(artifact: Artifact): Promise<boolean> {
  const bridge = window.tuttiExternal;
  if (!bridge?.files?.open || !artifact.localPath?.trim()) {
    return false;
  }

  try {
    const context = bridge.app?.getContext
      ? normalizeExternalAppContext(await bridge.app.getContext())
      : null;
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
