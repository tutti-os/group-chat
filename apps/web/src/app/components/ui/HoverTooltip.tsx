import { useState, type ComponentProps, type ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipTrigger,
} from "@tutti-os/ui-system/components";

export function HoverTooltip(props: {
  label: string;
  children: ReactNode;
  className?: string;
  side?: ComponentProps<typeof TooltipContent>["side"];
  align?: ComponentProps<typeof TooltipContent>["align"];
  sideOffset?: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <TooltipProvider delayDuration={120} skipDelayDuration={0} disableHoverableContent>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger
          asChild
          onPointerEnter={() => setOpen(true)}
          onPointerLeave={() => setOpen(false)}
          onClick={() => setOpen(false)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
        >
          <span className={`[display:inline-flex] ${props.className ?? ""}`}>{props.children}</span>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent side={props.side ?? "bottom"} align={props.align ?? "center"} sideOffset={props.sideOffset ?? 6}>
            {props.label}
          </TooltipContent>
        </TooltipPortal>
      </Tooltip>
    </TooltipProvider>
  );
}
