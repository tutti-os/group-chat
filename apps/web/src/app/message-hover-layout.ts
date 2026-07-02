export type MessageVisualAnchor = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type MessageActionBarPosition = {
  top: number;
  left: number;
  placement: "side" | "above";
};

/** Keep the time outside the message body while vertically following the hovered visual block. */
export function resolveMessageHoverTimePosition(anchor: MessageVisualAnchor, gap = 6) {
  return {
    top: anchor.top + anchor.height / 2,
    left: -gap,
  };
}

export function resolveMessageActionBarPosition(input: {
  anchor: MessageVisualAnchor;
  containerWidth: number;
  toolbarWidth: number;
  toolbarHeight: number;
  gap?: number;
}): MessageActionBarPosition {
  const gap = input.gap ?? 4;
  const toolbarWidth = Math.max(0, input.toolbarWidth);
  const toolbarHeight = Math.max(0, input.toolbarHeight);
  const maxLeft = Math.max(0, input.containerWidth - toolbarWidth);
  const preferredSideLeft = input.anchor.left + input.anchor.width + gap;

  if (preferredSideLeft + toolbarWidth <= input.containerWidth) {
    return {
      top: input.anchor.top,
      left: preferredSideLeft,
      placement: "side",
    };
  }

  return {
    top: Math.max(0, input.anchor.top - toolbarHeight - gap),
    left: clampNumber(input.anchor.left + input.anchor.width - toolbarWidth, 0, maxLeft),
    placement: "above",
  };
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
