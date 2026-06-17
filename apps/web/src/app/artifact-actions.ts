import type { AgentRun, Artifact, Message, MessageBlock } from "@group-chat/shared";
import { isVisibleGroupChatFile } from "@group-chat/shared";
import { openArtifactInSystem } from "../api/client.js";
import { isTextAttachment, type AttachmentPreview } from "./components/chat/AttachmentPreviewDialog.js";
import { tryOpenArtifactInTutti } from "./tutti-bridge.js";

export type ArtifactCategory = "image" | "video" | "file";
export type ArtifactFilterCategory = "all" | ArtifactCategory;

const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v", ".mpeg", ".mpg"];

export function getArtifactCategory(artifact: Artifact): ArtifactCategory {
  if (artifact.mimeType.startsWith("image/")) return "image";
  if (artifact.mimeType.startsWith("video/")) return "video";
  const lower = artifact.filename.toLowerCase();
  if (VIDEO_EXTENSIONS.some((extension) => lower.endsWith(extension))) return "video";
  return "file";
}

export function matchesArtifactCategory(artifact: Artifact, category: ArtifactFilterCategory) {
  if (category === "all") return true;
  return getArtifactCategory(artifact) === category;
}

export function filterGroupChatFiles(
  artifacts: Artifact[],
  messages: Message[],
  blocks: MessageBlock[],
  agentRuns: AgentRun[],
  conversationId?: string,
) {
  return artifacts.filter(
    (artifact) =>
      (!conversationId || artifact.conversationId === conversationId)
      && isVisibleGroupChatFile(artifact, messages, blocks, agentRuns),
  );
}

export function resolveArtifactPublicUrl(publicUrl: string) {
  if (publicUrl.startsWith("http://") || publicUrl.startsWith("https://")) return publicUrl;
  if (typeof window === "undefined") return publicUrl;
  return `${window.location.origin}${publicUrl}`;
}

export async function downloadArtifactFile(artifact: Artifact) {
  const url = resolveArtifactPublicUrl(artifact.publicUrl);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("download failed");
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = artifact.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
    return;
  } catch {
    const link = document.createElement("a");
    link.href = url;
    link.download = artifact.filename;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

export async function openArtifact(
  artifact: Artifact,
  setPreview: (preview: AttachmentPreview | null) => void,
) {
  return openArtifactPreview(artifact, setPreview);
}

export async function openArtifactPreview(
  artifact: Artifact,
  setPreview: (preview: AttachmentPreview | null) => void,
) {
  if (await tryOpenArtifactInTutti(artifact)) {
    return;
  }
  if (artifact.mimeType.startsWith("image/") || artifact.mimeType.startsWith("video/")) {
    setPreview({ title: artifact.filename, mimeType: artifact.mimeType, url: artifact.publicUrl });
    return;
  }
  if (isTextAttachment(artifact.mimeType, artifact.filename)) {
    setPreview({ title: artifact.filename, mimeType: artifact.mimeType, loading: true });
    try {
      const response = await fetch(artifact.publicUrl);
      const text = response.ok ? await response.text() : artifact.textPreview;
      setPreview({ title: artifact.filename, mimeType: artifact.mimeType, text: text ?? "" });
    } catch {
      setPreview({ title: artifact.filename, mimeType: artifact.mimeType, text: artifact.textPreview ?? "" });
    }
    return;
  }
  try {
    await openArtifactInSystem(artifact.id);
  } catch {
    window.open(resolveArtifactPublicUrl(artifact.publicUrl), "_blank", "noopener,noreferrer");
  }
}
