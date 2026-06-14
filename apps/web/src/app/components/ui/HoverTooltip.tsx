import type { ReactNode } from "react";

export function HoverTooltip(props: { label: string; children: ReactNode; className?: string }) {
  return (
    <span className={`group/hover-tip [position:relative] [display:inline-flex] ${props.className ?? ""}`}>
      {props.children}
      <span
        role="tooltip"
        className={"[position:absolute] [left:50%] [top:calc(100%+6px)] [z-index:40] [transform:translateX(-50%)] [border-radius:6px] [padding:4px_8px] [color:#ffffff] [background:#1f2329] [font-size:12px] [font-weight:500] [line-height:18px] [white-space:nowrap] [pointer-events:none] [opacity:0] [transition:opacity_0.12s_ease] group-hover/hover-tip:[opacity:1] group-focus-within/hover-tip:[opacity:1]"}
      >
        {props.label}
        <span
          aria-hidden
          className={"[position:absolute] [left:50%] [bottom:100%] [transform:translateX(-50%)] [width:0] [height:0] [border-left:5px_solid_transparent] [border-right:5px_solid_transparent] [border-bottom:5px_solid_#1f2329]"}
        />
      </span>
    </span>
  );
}
