const IGNORED_SEARCH_CHAR_PATTERN = /[\s\u200B-\u200D\uFEFF]/u;

type SearchIndex = {
  normalized: string;
  starts: number[];
  ends: number[];
};

export type SearchMatchRange = {
  start: number;
  end: number;
};

export function normalizeSearchQuery(query: string) {
  return buildSearchIndex(query).normalized;
}

export function searchTextIncludes(text: string, normalizedQuery: string) {
  if (!normalizedQuery) return false;
  return buildSearchIndex(text).normalized.includes(normalizedQuery);
}

export function findSearchTextMatches(text: string, normalizedQuery: string): SearchMatchRange[] {
  if (!normalizedQuery) return [];
  const indexed = buildSearchIndex(text);
  const matches: SearchMatchRange[] = [];
  let normalizedCursor = 0;
  while (normalizedCursor < indexed.normalized.length) {
    const normalizedIndex = indexed.normalized.indexOf(normalizedQuery, normalizedCursor);
    if (normalizedIndex < 0) break;
    const normalizedEndIndex = normalizedIndex + normalizedQuery.length - 1;
    const start = indexed.starts[normalizedIndex];
    const end = indexed.ends[normalizedEndIndex];
    if (start !== undefined && end !== undefined) matches.push({ start, end });
    normalizedCursor = normalizedIndex + normalizedQuery.length;
  }
  return matches;
}

function buildSearchIndex(text: string): SearchIndex {
  let normalized = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) break;
    const char = String.fromCodePoint(codePoint);
    const end = index + char.length;
    index = end;
    if (IGNORED_SEARCH_CHAR_PATTERN.test(char)) continue;
    for (const normalizedChar of char.toLowerCase()) {
      normalized += normalizedChar;
      starts.push(end - char.length);
      ends.push(end);
    }
  }
  return { normalized, starts, ends };
}
