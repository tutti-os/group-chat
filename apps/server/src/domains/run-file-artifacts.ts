import type { Artifact } from "@group-chat/shared";
import { extname, isAbsolute, relative, resolve } from "node:path";

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

const INTERNAL_AGENT_WORKSPACE_ROOT_FILES = new Set([
  "AGENTS.MD",
  "BOOTSTRAP.MD",
  "CLAUDE.MD",
  "DISTILLED_CONTEXT.MD",
  "IDENTITY.MD",
  "MEMORY.MD",
  "OWNER.MD",
  "SOUL.MD",
  "SOURCE.MD",
]);

const INTERNAL_AGENT_WORKSPACE_DIRS = new Set([
  "conversations",
  "memory",
  "skills",
]);

export function inferMimeTypeForPath(filePath: string) {
  const extension = extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.get(extension)
    ?? BINARY_EXTENSIONS.get(extension)
    ?? "application/octet-stream";
}

export function shouldImportRunFileArtifactPath(filePath: string, workspaceRoot: string) {
  const relativePath = relative(resolve(workspaceRoot), resolve(filePath)).replace(/\\/g, "/");
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) return true;

  const [firstSegment, ...rest] = relativePath.split("/");
  if (!firstSegment) return true;
  if (INTERNAL_AGENT_WORKSPACE_DIRS.has(firstSegment)) return false;
  return rest.length > 0 || !INTERNAL_AGENT_WORKSPACE_ROOT_FILES.has(firstSegment.toUpperCase());
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
  const entries = fileArtifacts
    .map((item) => ({ path: normalizePath(item.path), artifact: item.artifact }))
    .filter((item) => item.path)
    .sort((left, right) => right.path.length - left.path.length);

  for (const entry of entries) {
    const markdown = formatFileReferenceMarkdown(entry.artifact);

    result = replaceMarkdownLinksToNeedle(result, entry.path, markdown);
    result = replaceNeedleOutsideMarkdownLink(result, `\`${entry.path}\``, markdown);
    result = replaceNeedleOutsideMarkdownLink(result, entry.path, markdown);
  }
  return result;
}

export function extractLocalFilePathsFromContent(content: string) {
  const paths = new Set<string>();
  for (const match of content.matchAll(/`([^`]+)`/g)) {
    const value = cleanPathCandidate(match[1]);
    if (value && looksLikeLocalPath(value)) paths.add(value);
  }
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
    const value = cleanPathCandidate(match[1]);
    if (value && looksLikeLocalPath(value)) paths.add(value);
  }
  for (const match of content.matchAll(/(?:^|[\s：:])((?:\/[^\s`<>"')]+)|(?:[A-Za-z]:[\\/][^\s`<>"')]+))/g)) {
    const value = cleanPathCandidate(match[1]);
    if (value && looksLikeLocalPath(value)) paths.add(value);
  }
  for (const match of content.matchAll(relativeFilePathPattern())) {
    const value = cleanPathCandidate(match[1]);
    if (value && looksLikeLocalPath(value)) paths.add(value);
  }
  return [...paths];
}

function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, "/").trim();
}

function looksLikeLocalPath(value: string) {
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  if (/\s|[`<>"'|]/.test(value)) return false;
  if (value.startsWith("#")) return false;
  const extension = extname(value).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension) && !BINARY_EXTENSIONS.has(extension)) return false;
  return value.startsWith("./")
    || value.startsWith("../")
    || value.includes("/")
    || /^[\w@.-]+\.[A-Za-z0-9]+$/.test(value);
}

function cleanPathCandidate(value: string | undefined) {
  return value?.trim().replace(/[，。！？、；;,.!?]+$/u, "") ?? "";
}

function relativeFilePathPattern() {
  const extensions = [...TEXT_EXTENSIONS.keys(), ...BINARY_EXTENSIONS.keys()]
    .map((extension) => extension.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return new RegExp(
    String.raw`(?:^|[\s：:])((?:\.{1,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.(?:${extensions}))(?![\w.-])`,
    "gi",
  );
}

function replaceMarkdownLinksToNeedle(input: string, needle: string, replacement: string) {
  if (!needle) return input;
  return input.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (markdown, _label: string, href: string) => {
    return normalizePath(decodeUriSafe(href)) === needle ? replacement : markdown;
  });
}

function decodeUriSafe(value: string) {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function replaceNeedleOutsideMarkdownLink(input: string, needle: string, replacement: string) {
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
    output += isInsideMarkdownLink(input, index) ? needle : replacement;
    cursor = index + needle.length;
  }
  return output;
}

function isInsideMarkdownLink(input: string, index: number) {
  const hrefStart = input.lastIndexOf("](", index);
  const labelStart = input.lastIndexOf("[", index);
  const lastCloseParenBeforeIndex = input.lastIndexOf(")", index);
  const insideHref = hrefStart !== -1
    && labelStart !== -1
    && labelStart < hrefStart
    && lastCloseParenBeforeIndex <= hrefStart
    && input.indexOf(")", hrefStart + 2) >= index;
  if (insideHref) return true;

  const nextHrefStart = input.indexOf("](", index);
  if (labelStart === -1 || nextHrefStart === -1 || labelStart > nextHrefStart) return false;
  const previousCloseParen = input.lastIndexOf(")", index);
  if (previousCloseParen > labelStart) return false;
  const hrefEnd = input.indexOf(")", nextHrefStart + 2);
  return hrefEnd !== -1 && index < hrefEnd;
}
