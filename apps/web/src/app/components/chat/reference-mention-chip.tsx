import type { TuttiAtProviderId } from "@group-chat/shared";
import type { ReactNode } from "react";
import { TuttiReferenceIcon } from "../../tutti-reference-icons.js";

export const REFERENCE_MENTION_COLOR = "var(--accent-codex)";

export const PARTICIPANT_MENTION_CLASS = [
  "[display:inline]",
  "[color:var(--accent-codex)]",
  "[font-size:13px]",
  "[font-weight:400]",
  "[line-height:20px]",
  "[vertical-align:baseline]",
  "[white-space:nowrap]",
].join(" ");

export const REFERENCE_MENTION_CHIP_CLASS = [
  "[display:inline]",
  "[max-width:100%]",
  "[border:0]",
  "[border-radius:0]",
  "[padding:0]",
  "[color:var(--accent-codex)]",
  "[background:transparent]",
  "[box-shadow:none]",
  "[font-size:13px]",
  "[font-weight:600]",
  "[line-height:20px]",
  "[text-decoration:none]",
  "[cursor:pointer]",
  "[vertical-align:baseline]",
  "[white-space:nowrap]",
  "[opacity:0.95]",
  "hover:[text-decoration:none]",
  "hover:[opacity:1]",
].join(" ");

export const REFERENCE_MENTION_ICON_CLASS = [
  "[display:inline-block]",
  "[width:14px]",
  "[height:14px]",
  "[margin-right:4px]",
  "[vertical-align:-0.2em]",
].join(" ");

export const REFERENCE_MENTION_ICON_AFTER_CLASS = [
  "[display:inline-block]",
  "[width:14px]",
  "[height:14px]",
  "[margin-left:4px]",
  "[vertical-align:-0.2em]",
].join(" ");

export const REFERENCE_MENTION_LABEL_CLASS = [
  "[min-width:0]",
  "[overflow:hidden]",
  "[text-overflow:ellipsis]",
  "[white-space:nowrap]",
  "[line-height:20px]",
  "[vertical-align:baseline]",
].join(" ");

export function ReferenceMentionIcon(props: {
  providerId: TuttiAtProviderId;
  entityId?: string | null;
  iconUrl?: string | null;
}) {
  return (
    <TuttiReferenceIcon
      providerId={props.providerId}
      appId={props.entityId}
      iconUrl={props.iconUrl}
    />
  );
}

export function ReferenceMentionChip(props: {
  providerId: TuttiAtProviderId;
  label: ReactNode;
  entityId?: string | null;
  iconUrl?: string | null;
  href?: string;
  pasteMarkdown?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className={REFERENCE_MENTION_ICON_CLASS}>
        <ReferenceMentionIcon
          providerId={props.providerId}
          entityId={props.entityId}
          iconUrl={props.iconUrl}
        />
      </span>
      <span className={REFERENCE_MENTION_LABEL_CLASS} style={{ color: "var(--accent-codex)" }}>
        {props.label}
      </span>
    </>
  );

  if (props.href) {
    return (
      <a
        href={props.href}
        target="_blank"
        rel="noreferrer"
        data-mention-display-mode="reference-link"
        className={REFERENCE_MENTION_CHIP_CLASS}
        style={{ color: "var(--accent-codex)" }}
        onClick={(event) => {
          event.preventDefault();
          props.onClick?.();
        }}
      >
        {content}
      </a>
    );
  }

  return (
    <span
      role={props.onClick ? "button" : undefined}
      tabIndex={props.onClick ? 0 : undefined}
      data-mention-display-mode="reference-link"
      data-composer-paste-markdown={props.pasteMarkdown}
      className={REFERENCE_MENTION_CHIP_CLASS}
      style={{ color: "var(--accent-codex)" }}
      onClick={props.onClick}
      onKeyDown={props.onClick ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onClick?.();
        }
      } : undefined}
    >
      {content}
    </span>
  );
}
