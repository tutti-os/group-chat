import type { BackgroundTask } from "./background-tasks.js";
import { t } from "./i18n/index.js";

export type SummaryCardPresentation = {
  title: string;
  meta: string;
  body: string;
};

export const SUMMARY_LINK_CARD_CLASS =
  "[display:grid] [width:min(300px,_100%)] [min-width:0] [max-width:100%] [overflow:hidden] [gap:4px] [border:1px_solid_var(--border)] [border-radius:10px] [padding:8px_10px] [color:var(--text)] [background:#ffffff] [text-align:left] [box-shadow:0_1px_2px_rgb(0_0_0_/_4%)] [cursor:pointer] hover:[border-color:#cbd5e1] hover:[background:#f8fafc]";

export const SUMMARY_LINK_CARD_COMPOSER_CLASS =
  `${SUMMARY_LINK_CARD_CLASS} [margin:4px_0] [vertical-align:top]`;

function compactSummaryPreview(content: string, maxLength = 120) {
  const singleLine = content.replace(/\s+/g, " ").trim();
  if (!singleLine) return "";
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength - 1)}…`;
}

export function resolveSummaryCardPresentation(
  task: Pick<BackgroundTask, "participantName" | "content" | "sourcePreview" | "sourceMessageIds" | "status"> | null,
): SummaryCardPresentation {
  const title = t("summary.title");
  const meta = task
    ? task.sourceMessageIds.length > 1
      ? t("summary.cardMetaMulti", { name: task.participantName, count: task.sourceMessageIds.length })
      : task.participantName
    : "";
  const body = compactSummaryPreview(
    task?.content?.trim()
      || task?.sourcePreview?.trim()
      || (task?.status === "running" ? t("summary.generating") : t("messageActions.loadingSummary")),
  );
  return { title, meta, body };
}

export function createSummaryLinkChipElement(
  taskId: string,
  task: Pick<BackgroundTask, "participantName" | "content" | "sourcePreview" | "sourceMessageIds" | "status"> | null,
) {
  const presentation = resolveSummaryCardPresentation(task);
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.dataset.summaryLinkId = taskId;
  chip.className = SUMMARY_LINK_CARD_COMPOSER_CLASS;

  const titleRow = document.createElement("span");
  titleRow.className = "[display:block] [min-width:0] [overflow:hidden] [color:#2563eb] [font-size:12px] [font-weight:700] [line-height:1.3] [text-overflow:ellipsis] [white-space:nowrap]";
  titleRow.textContent = presentation.title;

  const metaRow = document.createElement("span");
  metaRow.className = "[display:block] [overflow:hidden] [color:var(--muted)] [font-size:11px] [font-weight:600] [line-height:1.35] [text-overflow:ellipsis] [white-space:nowrap]";
  metaRow.textContent = presentation.meta;

  const bodyRow = document.createElement("span");
  bodyRow.className = "[display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] [overflow:hidden] [color:var(--text)] [font-size:13px] [font-weight:500] [line-height:1.45]";
  bodyRow.textContent = presentation.body;

  chip.append(titleRow);
  if (presentation.meta) chip.append(metaRow);
  chip.append(bodyRow);
  return chip;
}
