import { useEffect, useState } from "react";
import type { TuttiAtProviderId } from "@group-chat/shared";
import { queryTuttiAtMentions, resolveMentionThumbnailUrl } from "./tutti-at-mentions.js";

const PRODUCT_PATH = "M14 1.001a3.4 3.4 0 0 1 2.411.998l3.586 3.586.116.121A3.4 3.4 0 0 1 21 8v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3zM8 16a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2zm0-4a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2zm0-4a1 1 0 0 0 0 2h2a1 1 0 1 0 0-2zm6.5-1.5a1 1 0 0 0 1 1h4l-5-5z";
const DOC_PATH = "M14 1.001a3.4 3.4 0 0 1 2.411.998l3.586 3.586.116.121A3.4 3.4 0 0 1 21 8v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3zm.5 5.499a1 1 0 0 0 1 1h4l-5-5z";
const ISSUE_PATH = "M18.75 2a3.4 3.4 0 0 1 2.255.838c.62.55.995 1.326.995 2.162v14c0 .836-.375 1.611-.995 2.162A3.4 3.4 0 0 1 18.75 22H5.25a3.4 3.4 0 0 1-2.255-.838A2.9 2.9 0 0 1 2 19V5c0-.836.375-1.611.995-2.162A3.4 3.4 0 0 1 5.25 2zm-7.912 12.115a1 1 0 0 0-1.414 0l-2.047 2.047-.67-.67a1 1 0 0 0-1.414 1.414l1.377 1.377a1 1 0 0 0 1.414 0l2.754-2.754a1 1 0 0 0 0-1.414m3.046 2.298a1 1 0 0 0 0 2h4a1 1 0 1 0 0-2zm0-5.5a1 1 0 0 0 0 2h4a1 1 0 1 0 0-2zM6.688 5.25C5.756 5.25 5 6.006 5 6.938v2.754c0 .933.756 1.689 1.688 1.689h2.754a1.69 1.69 0 0 0 1.689-1.689V6.938c0-.932-.756-1.688-1.689-1.688zm2.443 2v2.13H7V7.25zm4.753-1.837a1 1 0 0 0 0 2h4a1 1 0 0 0 0-2z";
const SESSION_PATH = "M20.833 2.125a3.085 3.085 0 0 1 3.083 3.083v12.5a3.084 3.084 0 0 1-3.083 3.084H7.113c-.288 0-.563.114-.766.317l-2.294 2.294a1.74 1.74 0 0 1-2.97-1.23V5.208a3.084 3.084 0 0 1 3.083-3.083zM8.5 9A1.5 1.5 0 0 0 7 10.5v2a1.5 1.5 0 0 0 3 0v-2A1.5 1.5 0 0 0 8.5 9m8 0a1.5 1.5 0 0 0-1.5 1.5v2a1.5 1.5 0 0 0 3 0v-2A1.5 1.5 0 0 0 16.5 9";

function workspaceAppIconUrl(_appId?: string | null, iconUrl?: string | null) {
  return iconUrl?.trim() || null;
}

function referenceIconPath(providerId: TuttiAtProviderId) {
  switch (providerId) {
    case "workspace-app":
      return { d: PRODUCT_PATH, viewBox: "0 0 24 24" };
    case "workspace-issue":
      return { d: ISSUE_PATH, viewBox: "0 0 24 24" };
    case "agent-session":
      return { d: SESSION_PATH, viewBox: "0 0 25 25" };
    case "file":
    case "agent-generated-file":
    default:
      return { d: DOC_PATH, viewBox: "0 0 24 24" };
  }
}

function ReferenceGlyph(props: { providerId: TuttiAtProviderId; className?: string }) {
  const icon = referenceIconPath(props.providerId);
  return (
    <svg width="14" height="14" viewBox={icon.viewBox} aria-hidden="true" className={props.className}>
      <path d={icon.d} fill="currentColor" />
    </svg>
  );
}

export function TuttiReferenceIcon(props: {
  providerId: TuttiAtProviderId;
  appId?: string | null;
  iconUrl?: string | null;
  className?: string;
}) {
  const explicitIconUrl = props.iconUrl?.trim() || null;
  const appId = props.appId?.trim() || null;
  const [resolvedIconUrl, setResolvedIconUrl] = useState<string | null>(explicitIconUrl);
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);

  useEffect(() => {
    setResolvedIconUrl(explicitIconUrl);
    setFailedIconUrl(null);
  }, [explicitIconUrl, appId]);

  useEffect(() => {
    if (props.providerId !== "workspace-app" || explicitIconUrl || !appId) return;
    let cancelled = false;
    void queryTuttiAtMentions({
      keyword: appId,
      maxResults: 20,
      providers: ["workspace-app"],
    }).then((items) => {
      if (cancelled) return;
      const match = items.find((item) => item.providerId === "workspace-app" && item.itemId === appId);
      const thumbnailUrl = resolveMentionThumbnailUrl(match?.thumbnailUrl);
      if (thumbnailUrl) setResolvedIconUrl(thumbnailUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [appId, explicitIconUrl, props.providerId]);

  const iconUrl = props.providerId === "workspace-app"
    ? workspaceAppIconUrl(appId, resolvedIconUrl)
    : null;

  if (iconUrl && iconUrl !== failedIconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        className={props.className ?? "[width:14px] [height:14px] [border-radius:3px] [object-fit:cover]"}
        draggable={false}
        onError={() => setFailedIconUrl(iconUrl)}
      />
    );
  }

  return <ReferenceGlyph providerId={props.providerId} className={props.className} />;
}

export function TuttiMessageLinkIcon(props: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={props.className ?? "[display:inline-grid] [flex:0_0_auto] [width:16px] [height:16px] [place-items:center] [overflow:hidden] [border-radius:4px] [background:var(--tutti-purple-bg)]"}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="1.5" y="1.5" width="13" height="13" rx="3.5" fill="var(--background-panel)" />
        <path d="M4 5.6A2.6 2.6 0 0 1 6.6 3h2.8A2.6 2.6 0 0 1 12 5.6v2.1a2.6 2.6 0 0 1-2.6 2.6H7.05L4.9 12.05a.55.55 0 0 1-.9-.43z" fill="var(--accent-codex)" />
        <circle cx="6.2" cy="6.75" r=".65" fill="var(--white-stationary)" />
        <circle cx="8" cy="6.75" r=".65" fill="var(--white-stationary)" />
        <path d="M10.25 10.2c1.22 0 2.2.82 2.2 1.84v1.1l-1.28-.92h-.92c-1.22 0-2.2-.82-2.2-1.84s.98-1.84 2.2-1.84z" fill="var(--rich-text-mention-app)" />
      </svg>
    </span>
  );
}

function createSvgElement(viewBox: string, pathD: string) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathD);
  path.setAttribute("fill", "currentColor");
  svg.append(path);
  return svg;
}

export function createTuttiReferenceIconElement(
  providerId: TuttiAtProviderId,
  options?: { appId?: string | null; iconUrl?: string | null },
) {
  const iconUrl = providerId === "workspace-app"
    ? workspaceAppIconUrl(options?.appId, options?.iconUrl)
    : null;
  if (iconUrl) {
    const img = document.createElement("img");
    img.src = iconUrl;
    img.alt = "";
    img.width = 14;
    img.height = 14;
    img.draggable = false;
    img.style.width = "14px";
    img.style.height = "14px";
    img.style.objectFit = "cover";
    img.style.borderRadius = "3px";
    img.onerror = () => {
      img.replaceWith(createTuttiReferenceIconElement(providerId));
    };
    return img;
  }

  const icon = referenceIconPath(providerId);
  return createSvgElement(icon.viewBox, icon.d);
}

export function createTuttiMessageLinkIconElement() {
  const span = document.createElement("span");
  span.setAttribute("aria-hidden", "true");
  span.style.display = "inline-grid";
  span.style.flex = "0 0 auto";
  span.style.width = "16px";
  span.style.height = "16px";
  span.style.placeItems = "center";
  span.style.overflow = "hidden";
  span.style.borderRadius = "4px";
  span.style.background = "var(--tutti-purple-bg)";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");

  const add = (tag: string, attrs: Record<string, string>) => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
    svg.append(element);
  };
  add("rect", { x: "1.5", y: "1.5", width: "13", height: "13", rx: "3.5", fill: "var(--background-panel)" });
  add("path", { d: "M4 5.6A2.6 2.6 0 0 1 6.6 3h2.8A2.6 2.6 0 0 1 12 5.6v2.1a2.6 2.6 0 0 1-2.6 2.6H7.05L4.9 12.05a.55.55 0 0 1-.9-.43z", fill: "var(--accent-codex)" });
  add("circle", { cx: "6.2", cy: "6.75", r: ".65", fill: "var(--white-stationary)" });
  add("circle", { cx: "8", cy: "6.75", r: ".65", fill: "var(--white-stationary)" });
  add("path", { d: "M10.25 10.2c1.22 0 2.2.82 2.2 1.84v1.1l-1.28-.92h-.92c-1.22 0-2.2-.82-2.2-1.84s.98-1.84 2.2-1.84z", fill: "var(--rich-text-mention-app)" });

  span.append(svg);
  return span;
}
