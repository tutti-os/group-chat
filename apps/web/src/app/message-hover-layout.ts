export type MessageVisualAnchor = {
  top: number;
  left: number;
  width: number;
  height: number;
};

/** Keep the time outside the message body while vertically following the hovered visual block. */
export function resolveMessageHoverTimePosition(anchor: MessageVisualAnchor, gap = 6) {
  return {
    top: anchor.top + anchor.height / 2,
    left: -gap,
  };
}
