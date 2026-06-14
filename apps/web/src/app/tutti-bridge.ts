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
  appContext?: {
    get(): Promise<{ workspaceId?: string }>;
  };
}

declare global {
  interface Window {
    tutti?: TuttiWorkspaceAppBridge;
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
    const context = bridge.appContext ? await bridge.appContext.get() : null;
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
