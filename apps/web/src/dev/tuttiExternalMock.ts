import type { TuttiAtProviderId } from "@group-chat/shared";
import type { TuttiAtQueryResult } from "../app/tutti-bridge.js";

const devWorkspaceId = "dev-workspace";

type LocalizedText = { en: string; "zh-CN": string };

type MockFixture = {
  providerId: TuttiAtProviderId;
  itemId: string;
  label: LocalizedText | string;
  subtitle: LocalizedText;
  insert:
    | {
        kind: "markdown-link";
        label: LocalizedText | string;
        href: string;
      }
    | {
        kind: "mention";
        entityId: string;
        label: LocalizedText;
        scope: Readonly<Record<string, string>>;
      };
};

const fixtureItems: readonly MockFixture[] = [
  {
    providerId: "file",
    itemId: "README.md",
    label: "README.md",
    subtitle: { en: "Repository root (mock)", "zh-CN": "仓库根目录（模拟）" },
    insert: {
      kind: "markdown-link",
      label: "README.md",
      href: "README.md",
    },
  },
  {
    providerId: "file",
    itemId: "apps/web/src/main.tsx",
    label: "main.tsx",
    subtitle: { en: "apps/web/src/main.tsx (mock)", "zh-CN": "apps/web/src/main.tsx（模拟）" },
    insert: {
      kind: "markdown-link",
      label: "main.tsx",
      href: "apps/web/src/main.tsx",
    },
  },
  {
    providerId: "workspace-issue",
    itemId: "issue-42",
    label: { en: "Mention logic rollout", "zh-CN": "提及逻辑上线" },
    subtitle: { en: "In progress (mock)", "zh-CN": "进行中（模拟）" },
    insert: {
      kind: "mention",
      entityId: "issue-42",
      label: { en: "Mention logic rollout", "zh-CN": "提及逻辑上线" },
      scope: {
        workspaceId: devWorkspaceId,
        topicId: "dev-topic",
      },
    },
  },
  {
    providerId: "workspace-issue",
    itemId: "issue-7",
    label: { en: "Fix composer @ menu", "zh-CN": "修复输入框 @ 菜单" },
    subtitle: { en: "Open (mock)", "zh-CN": "待处理（模拟）" },
    insert: {
      kind: "mention",
      entityId: "issue-7",
      label: { en: "Fix composer @ menu", "zh-CN": "修复输入框 @ 菜单" },
      scope: {
        workspaceId: devWorkspaceId,
        topicId: "dev-topic",
      },
    },
  },
  {
    providerId: "workspace-app",
    itemId: "ai-canvas",
    label: { en: "AI Canvas", "zh-CN": "AI Canvas" },
    subtitle: { en: "Workspace app", "zh-CN": "工作区应用" },
    insert: {
      kind: "mention",
      entityId: "ai-canvas",
      label: { en: "AI Canvas", "zh-CN": "AI Canvas" },
      scope: {
        workspaceId: devWorkspaceId,
      },
    },
  },
  {
    providerId: "workspace-app",
    itemId: "prototype-design",
    label: { en: "Prototype Design", "zh-CN": "Prototype Design" },
    subtitle: { en: "Workspace app", "zh-CN": "工作区应用" },
    insert: {
      kind: "mention",
      entityId: "prototype-design",
      label: { en: "Prototype Design", "zh-CN": "Prototype Design" },
      scope: {
        workspaceId: devWorkspaceId,
      },
    },
  },
  {
    providerId: "agent-session",
    itemId: "session-7",
    label: { en: "Refactor mention chips", "zh-CN": "重构提及标签" },
    subtitle: { en: "Running (mock)", "zh-CN": "运行中（模拟）" },
    insert: {
      kind: "mention",
      entityId: "session-7",
      label: { en: "Refactor mention chips", "zh-CN": "重构提及标签" },
      scope: {
        workspaceId: devWorkspaceId,
      },
    },
  },
  {
    providerId: "agent-session",
    itemId: "session-3",
    label: { en: "Review multiplayer UX", "zh-CN": "审查多人 UX" },
    subtitle: { en: "Idle (mock)", "zh-CN": "空闲（模拟）" },
    insert: {
      kind: "mention",
      entityId: "session-3",
      label: { en: "Review multiplayer UX", "zh-CN": "审查多人 UX" },
      scope: {
        workspaceId: devWorkspaceId,
      },
    },
  },
  {
    providerId: "agent-generated-file",
    itemId: "outputs/summary.md",
    label: "summary.md",
    subtitle: { en: "Generated output (mock)", "zh-CN": "生成输出（模拟）" },
    insert: {
      kind: "markdown-link",
      label: "summary.md",
      href: "outputs/summary.md",
    },
  },
  {
    providerId: "agent-generated-file",
    itemId: "outputs/plan.json",
    label: "plan.json",
    subtitle: { en: "Generated output (mock)", "zh-CN": "生成输出（模拟）" },
    insert: {
      kind: "markdown-link",
      label: "plan.json",
      href: "outputs/plan.json",
    },
  },
];

function resolveMockLocale(): "en" | "zh-CN" {
  if (typeof navigator === "undefined") return "en";
  const candidates = [...(navigator.languages ?? []), navigator.language];
  for (const candidate of candidates) {
    const next = String(candidate ?? "")
      .trim()
      .replace("_", "-")
      .toLowerCase();
    if (next === "zh" || next.startsWith("zh-")) return "zh-CN";
    if (next === "en" || next.startsWith("en-")) return "en";
  }
  return "en";
}

function pickText(value: LocalizedText | string): string {
  if (typeof value === "string") return value;
  return value[resolveMockLocale()];
}

function toQueryResult(fixture: MockFixture): TuttiAtQueryResult {
  const label = pickText(fixture.label);
  const subtitle = pickText(fixture.subtitle);
  if (fixture.insert.kind === "markdown-link") {
    return {
      providerId: fixture.providerId,
      itemId: fixture.itemId,
      label,
      subtitle,
      insert: {
        kind: "markdown-link",
        label: pickText(fixture.insert.label),
        href: fixture.insert.href,
      },
    };
  }
  const mentionLabel = pickText(fixture.insert.label);
  return {
    providerId: fixture.providerId,
    itemId: fixture.itemId,
    label,
    subtitle,
    insert: {
      kind: "mention",
      entityId: fixture.insert.entityId,
      label: mentionLabel,
      scope: fixture.insert.scope,
    },
  };
}

function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase();
}

function matchesKeyword(item: TuttiAtQueryResult, keyword: string): boolean {
  if (!keyword) return true;
  const haystack = [item.label, item.subtitle ?? "", item.itemId, item.providerId].join(" ").toLowerCase();
  return haystack.includes(keyword);
}

function createMockBridge() {
  return {
    app: {
      async getContext() {
        const locale = resolveMockLocale();
        return {
          appId: "group-chat",
          locale,
          workspaceId: devWorkspaceId,
        };
      },
      subscribe(listener: (context: { locale?: string } & Record<string, unknown>) => void) {
        void this.getContext().then(listener);
        return () => undefined;
      },
    },
    at: {
      async query(input: {
        keyword: string;
        maxResults?: number;
        providers?: readonly TuttiAtProviderId[];
      }) {
        const keyword = normalizeKeyword(input.keyword);
        const allowedProviders = input.providers?.length ? new Set(input.providers) : null;
        const maxResults = Math.max(0, input.maxResults ?? 20);
        const localizedItems = fixtureItems.map(toQueryResult);
        const filtered = localizedItems.filter((item) => {
          if (allowedProviders && !allowedProviders.has(item.providerId)) return false;
          return matchesKeyword(item, keyword);
        });
        await new Promise((resolve) => window.setTimeout(resolve, 80));
        return filtered.slice(0, maxResults);
      },
    },
    files: {
      async open(input: { path: string; name?: string }) {
        console.info("[tuttiExternal mock] files.open", input);
      },
    },
  };
}

if (typeof window !== "undefined" && !window.tuttiExternal) {
  window.tuttiExternal = createMockBridge();
}

export {};
