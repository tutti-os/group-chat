import type { TuttiAtProviderId } from "@group-chat/shared";
import type { ReactNode } from "react";
import { formatAgentLauncherMentionLabel } from "../../agent-launcher-mentions.js";
import { getRuntimeProviderAvatarIconUrl } from "../../identity-avatar.js";
import { TuttiReferenceIcon } from "../../tutti-reference-icons.js";

export const REFERENCE_MENTION_COLOR = "#2563eb";

export const PARTICIPANT_MENTION_CLASS = [
  "[display:inline]",
  "[color:#2563eb]",
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
  "[color:#2563eb]",
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

export const AGENT_LAUNCHER_MENTION_ICON_CLASS = [
  "[display:inline-block]",
  "[width:14px]",
  "[height:14px]",
  "[margin:0_4px]",
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

function AgentLauncherMentionIcon(props: { runtimeProvider: string }) {
  const iconUrl = getRuntimeProviderAvatarIconUrl(props.runtimeProvider);
  if (!iconUrl) {
    return <ReferenceMentionIcon providerId="agent-session" />;
  }
  return <img src={iconUrl} alt="" className="[width:14px] [height:14px] [border-radius:3px] [object-fit:cover]" />;
}

export function splitAgentLauncherMentionLabel(label: string) {
  const displayLabel = formatAgentLauncherMentionLabel(label);
  return {
    prefix: "@",
    name: displayLabel.replace(/^@+/, ""),
  };
}

export function AgentLauncherMentionChip(props: {
  label: ReactNode;
  runtimeProvider: string;
  pasteMarkdown?: string;
  onClick?: () => void;
}) {
  const displayLabel = typeof props.label === "string"
    ? splitAgentLauncherMentionLabel(props.label)
    : null;

  return (
    <span
      role="button"
      tabIndex={0}
      data-mention-display-mode="agent-launcher"
      data-composer-paste-markdown={props.pasteMarkdown}
      className={REFERENCE_MENTION_CHIP_CLASS}
      style={{ color: "var(--accent)" }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onClick?.();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        props.onClick?.();
      }}
    >
      {displayLabel ? (
        <span aria-hidden="true">@</span>
      ) : null}
      <span className={displayLabel ? AGENT_LAUNCHER_MENTION_ICON_CLASS : REFERENCE_MENTION_ICON_AFTER_CLASS}>
        <AgentLauncherMentionIcon runtimeProvider={props.runtimeProvider} />
      </span>
      <span className={REFERENCE_MENTION_LABEL_CLASS} style={{ color: "var(--accent)" }}>
        {displayLabel ? displayLabel.name : props.label}
      </span>
    </span>
  );
}

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
      <span className={REFERENCE_MENTION_LABEL_CLASS} style={{ color: "var(--accent)" }}>
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
        style={{ color: "var(--accent)" }}
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
      style={{ color: "var(--accent)" }}
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
