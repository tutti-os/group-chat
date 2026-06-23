import type { Artifact } from "@group-chat/shared";
import { extname } from "node:path";

const TEXT_EXTENSIONS = new Map<string, string>([
  [".css", "text/css"],
  [".csv", "text/csv"],
  [".html", "text/html"],
  [".htm", "text/html"],
  [".js", "text/javascript"],
  [".json", "application/json"],
  [".jsx", "text/javascript"],
  [".log", "text/plain"],
  [".md", "text/markdown"],
  [".mjs", "text/javascript"],
  [".ts", "text/typescript"],
  [".tsx", "text/typescript"],
  [".txt", "text/plain"],
  [".xml", "application/xml"],
  [".yaml", "application/yaml"],
  [".yml", "application/yaml"],
]);

const BINARY_EXTENSIONS = new Map<string, string>([
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".mov", "video/quicktime"],
  [".mp4", "video/mp4"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
]);

export function inferMimeTypeForPath(filePath: string) {
  const extension = extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.get(extension)
    ?? BINARY_EXTENSIONS.get(extension)
    ?? "application/octet-stream";
}

export function formatFileReferenceMarkdown(artifact: Pick<Artifact, "id" | "filename">) {
  const safeLabel = artifact.filename.replace(/\\/g, "\\\\").replace(/\[/g, "\\[");
  return `[${safeLabel}](group-chat://reference/file/${encodeURIComponent(artifact.id)})`;
}

export function linkRunFileArtifactPathsInContent(
  content: string,
  fileArtifacts: Array<{ path: string; artifact: Pick<Artifact, "id" | "filename"> }>,
) {
  let result = content;
  const seenArtifactIds = new Set<string>();
  const entries = fileArtifacts
    .map((item) => ({ path: normalizePath(item.path), artifact: item.artifact }))
    .filter((item) => item.path)
    .sort((left, right) => right.path.length - left.path.length);

  for (const entry of entries) {
    if (seenArtifactIds.has(entry.artifact.id)) continue;
    seenArtifactIds.add(entry.artifact.id);
    const markdown = formatFileReferenceMarkdown(entry.artifact);
    if (result.includes(markdown)) continue;

    result = replaceNeedleOutsideMarkdownLinkHref(result, `\`${entry.path}\``, markdown);
    result = replaceNeedleOutsideMarkdownLinkHref(result, entry.path, markdown);
  }
  return result;
}

export function extractLocalFilePathsFromContent(content: string) {
  const paths = new Set<string>();
  for (const match of content.matchAll(/`([^`]+)`/g)) {
    const value = match[1]?.trim();
    if (value && looksLikeLocalPath(value)) paths.add(value);
  }
  for (const match of content.matchAll(/(?:^|[\s：:])((?:\/[^\s`<>"')]+)|(?:[A-Za-z]:[\\/][^\s`<>"')]+))/g)) {
    const value = match[1]?.trim();
    if (value && looksLikeLocalPath(value)) paths.add(value);
  }
  return [...paths];
}

function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, "/").trim();
}

function looksLikeLocalPath(value: string) {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

function replaceNeedleOutsideMarkdownLinkHref(input: string, needle: string, replacement: string) {
  if (!needle || !input.includes(needle)) return input;
  let output = "";
  let cursor = 0;
  while (cursor < input.length) {
    const index = input.indexOf(needle, cursor);
    if (index === -1) {
      output += input.slice(cursor);
      break;
    }
    output += input.slice(cursor, index);
    output += isInsideMarkdownLinkHref(input, index) ? needle : replacement;
    cursor = index + needle.length;
  }
  return output;
}

function isInsideMarkdownLinkHref(input: string, index: number) {
  const hrefStart = input.lastIndexOf("](", index);
  if (hrefStart === -1) return false;
  const linkLabelStart = input.lastIndexOf("[", hrefStart);
  if (linkLabelStart === -1) return false;
  const lastCloseParenBeforeIndex = input.lastIndexOf(")", index);
  if (lastCloseParenBeforeIndex > hrefStart) return false;
  const hrefEnd = input.indexOf(")", hrefStart + 2);
  return hrefEnd !== -1 && hrefEnd >= index;
}
