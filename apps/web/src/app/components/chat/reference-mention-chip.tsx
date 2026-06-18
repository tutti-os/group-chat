import type { TuttiAtProviderId } from "@group-chat/shared";
import type { ReactNode } from "react";

export const REFERENCE_MENTION_COLOR = "#2563eb";

export const REFERENCE_MENTION_CHIP_CLASS = [
  "[display:inline-flex]",
  "[align-items:center]",
  "[gap:4px]",
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
  "[opacity:0.95]",
  "hover:[text-decoration:none]",
  "hover:[opacity:1]",
].join(" ");

function FileReferenceMentionIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M3.25 1.75h4.75l2.75 2.75v7a.75.75 0 0 1-.75.75H3.25a.75.75 0 0 1-.75-.75V2.5a.75.75 0 0 1 .75-.75Z"
        fill={REFERENCE_MENTION_COLOR}
      />
      <path d="M8 1.75V4.5H10.75" fill="#93c5fd" />
      <path d="M4.25 6.75h5.5" stroke="#ffffff" strokeWidth="1" strokeLinecap="round" />
      <path d="M4.25 8.75h5.5" stroke="#ffffff" strokeWidth="1" strokeLinecap="round" />
      <path d="M4.25 10.75h3.5" stroke="#ffffff" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function StrokeIcon(props: { d: string }) {
  return (
    <path
      d={props.d}
      stroke={REFERENCE_MENTION_COLOR}
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  );
}

export function ReferenceMentionIcon(props: { providerId: TuttiAtProviderId }) {
  if (props.providerId === "file" || props.providerId === "agent-generated-file") {
    return <FileReferenceMentionIcon />;
  }

  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      {props.providerId === "agent-session" ? (
        <>
          <StrokeIcon d="M4.5 4.75a2.25 2.25 0 1 1 4.5 0 2.25 2.25 0 0 1-4.5 0Z" />
          <StrokeIcon d="M2.75 11.25c0-1.75 1.9-2.75 4.25-2.75s4.25 1 4.25 2.75" />
        </>
      ) : null}
      {props.providerId === "workspace-app" ? (
        <>
          <StrokeIcon d="M3 3.25h8v7.5H3z" />
          <StrokeIcon d="M3 5.75h8" />
          <StrokeIcon d="M5.25 3.25V2.25h3.5v1" />
        </>
      ) : null}
      {props.providerId === "workspace-issue" ? (
        <>
          <StrokeIcon d="M3.25 2.75h7.5" />
          <StrokeIcon d="M3.25 5.75h7.5" />
          <StrokeIcon d="M3.25 8.75h5" />
          <StrokeIcon d="M3.25 11.25h7.5" />
        </>
      ) : null}
    </svg>
  );
}

export function ReferenceMentionChip(props: {
  providerId: TuttiAtProviderId;
  label: ReactNode;
  href?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="[display:inline-flex] [flex:0_0_auto] [align-items:center] [justify-content:center]">
        <ReferenceMentionIcon providerId={props.providerId} />
      </span>
      <span className="[min-width:0] [overflow:hidden] [text-overflow:ellipsis] [white-space:nowrap]" style={{ color: "var(--accent)" }}>
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
