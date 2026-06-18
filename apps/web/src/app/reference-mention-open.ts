import type { Artifact, MentionTarget } from "@group-chat/shared";
import { revealArtifactInTuttiFileManager } from "./artifact-actions.js";
import { parseReferenceMentionHref } from "./reference-mentions.js";
import {
  buildTuttiMentionHref,
  extractAppDataRelativePath,
  isOpenableTuttiReferenceProvider,
  tryOpenFileInTuttiSync,
  tryOpenReferenceHrefInTuttiSync,
  tryOpenTuttiReferenceMention,
} from "./tutti-bridge.js";

type ReferenceMentionMeta = Pick<
  MentionTarget,
  "referenceProviderId" | "referenceEntityId" | "referenceScope" | "referenceInsert"
>;

function isFileReferenceProvider(providerId: string) {
  return providerId === "file" || providerId === "agent-generated-file";
}

function findArtifactForReference(
  fileHref: string,
  entityId: string,
  artifacts: Artifact[],
) {
  const normalizedHref = fileHref.replace(/\\/g, "/");
  return artifacts.find((item) => {
    const localPath = item.localPath?.replace(/\\/g, "/") ?? "";
    const publicUrl = item.publicUrl?.replace(/\\/g, "/") ?? "";
    return (
      localPath === normalizedHref
      || localPath.endsWith(`/${normalizedHref}`)
      || publicUrl === normalizedHref
      || publicUrl.endsWith(`/${normalizedHref}`)
      || item.id === entityId
    );
  }) ?? null;
}

function openFileReference(
  providerId: string,
  entityId: string,
  label: string,
  mention: ReferenceMentionMeta | null,
  artifacts: Artifact[],
) {
  const insert = mention?.referenceInsert;
  const fileHref = insert?.kind === "markdown-link" ? insert.href : entityId;
  if (!fileHref) return;

  const artifact = findArtifactForReference(fileHref, entityId, artifacts);
  if (artifact) {
    revealArtifactInTuttiFileManager(artifact);
    return;
  }

  const appDataPath = extractAppDataRelativePath(fileHref);
  tryOpenFileInTuttiSync({
    path: appDataPath ?? fileHref,
    location: appDataPath
      ? { type: "app-data-relative", path: appDataPath }
      : { type: "workspace-relative", path: fileHref },
    name: label || fileHref.split("/").pop() || fileHref,
    mode: "reveal",
  });
}

export function openReferenceMentionTarget(
  href: string,
  label: string,
  mention: ReferenceMentionMeta | null,
  artifacts: Artifact[],
) {
  const trimmedHref = href.trim();
  if (trimmedHref.startsWith("mention://")) {
    tryOpenReferenceHrefInTuttiSync(trimmedHref);
    return;
  }

  const parsed = parseReferenceMentionHref(trimmedHref);
  if (!parsed) return;

  const providerId = mention?.referenceProviderId ?? parsed.providerId;
  const entityId = mention?.referenceEntityId?.trim() || parsed.entityId;

  if (isOpenableTuttiReferenceProvider(providerId)) {
    const mentionHref = buildTuttiMentionHref(providerId, entityId, {
      referenceInsert: mention?.referenceInsert,
      referenceScope: mention?.referenceScope,
    });
    if (mentionHref && tryOpenReferenceHrefInTuttiSync(mentionHref)) {
      return;
    }
    void tryOpenTuttiReferenceMention(providerId, entityId, {
      referenceInsert: mention?.referenceInsert,
      referenceScope: mention?.referenceScope,
    });
    return;
  }

  if (isFileReferenceProvider(providerId)) {
    openFileReference(providerId, entityId, label, mention, artifacts);
  }
}
