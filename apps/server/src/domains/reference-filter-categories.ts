/**
 * 全局统一「文件类型筛选分类」—— 与 Tutti 宿主侧口径一致。宿主在 references/search
 * 请求里下发 filters(分类 id 数组),各源 daemon 按扩展名真正过滤。
 *
 * 这是 group-chat 侧的镜像。权威来源在 Tutti:
 *   packages/workspace/file-reference/src/core/referenceFilterCategories.ts
 *   packages/workspace/referencefilter/categories.go
 * 三处扩展名清单必须保持一致 —— 改一处务必同步另外两处。
 */

export type ReferenceFilterCategoryId =
  | "image"
  | "document"
  | "spreadsheet"
  | "code"
  | "media"
  | "archive"
  | "other";

interface ReferenceFilterCategory {
  id: ReferenceFilterCategoryId;
  /** 该分类归属的文件扩展名(小写,不含点)。"other" 为空,表示「未收录/无扩展名」兜底。 */
  extensions: readonly string[];
}

const REFERENCE_FILTER_CATEGORIES: readonly ReferenceFilterCategory[] = [
  {
    id: "image",
    extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "heic"],
  },
  {
    id: "document",
    extensions: ["pdf", "doc", "docx", "txt", "md", "markdown", "rtf", "odt", "pages", "key", "ppt", "pptx"],
  },
  {
    id: "spreadsheet",
    extensions: ["xls", "xlsx", "csv", "tsv", "numbers"],
  },
  {
    id: "code",
    extensions: [
      "js",
      "jsx",
      "ts",
      "tsx",
      "py",
      "go",
      "java",
      "c",
      "h",
      "cpp",
      "cc",
      "rs",
      "rb",
      "php",
      "swift",
      "kt",
      "sh",
      "json",
      "yaml",
      "yml",
      "toml",
      "xml",
      "html",
      "css",
      "scss",
      "sql",
    ],
  },
  {
    id: "media",
    extensions: ["mp3", "wav", "flac", "aac", "ogg", "m4a", "mp4", "mov", "avi", "mkv", "webm"],
  },
  {
    id: "archive",
    extensions: ["zip", "tar", "gz", "tgz", "rar", "7z", "bz2"],
  },
  { id: "other", extensions: [] },
];

const VALID_CATEGORY_IDS: ReadonlySet<string> = new Set(REFERENCE_FILTER_CATEGORIES.map((category) => category.id));

const CATEGORY_BY_EXTENSION: ReadonlyMap<string, ReferenceFilterCategoryId> = new Map(
  REFERENCE_FILTER_CATEGORIES.flatMap((category) => category.extensions.map((ext) => [ext, category.id] as const)),
);

/** 从文件名末段推断分类;无扩展名或未收录的扩展名归入「other」。 */
export function categoryOfFileName(name: string): ReferenceFilterCategoryId {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) return "other";
  const ext = name.slice(dotIndex + 1).toLowerCase();
  return CATEGORY_BY_EXTENSION.get(ext) ?? "other";
}

/** 仅保留已知的分类 id;未知 id 忽略(与宿主「未知 id 忽略」约定一致)。 */
export function normalizeFilterCategoryIds(ids: readonly string[]): ReferenceFilterCategoryId[] {
  const seen = new Set<string>();
  const out: ReferenceFilterCategoryId[] = [];
  for (const id of ids) {
    const trimmed = id.trim().toLowerCase();
    if (!VALID_CATEGORY_IDS.has(trimmed) || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed as ReferenceFilterCategoryId);
  }
  return out;
}

/**
 * 分类筛选判定:空 ids = 不筛选(全部通过);否则仅当文件分类命中所选分类时通过。
 * group-chat 的引用全为文件,不涉及文件夹兜底。
 */
export function matchesFilterCategories(name: string, filterIds: readonly string[]): boolean {
  if (filterIds.length === 0) return true;
  return filterIds.includes(categoryOfFileName(name));
}
