import { Bot, MessageCircle } from "lucide-react";
import type { ReactNode } from "react";

function NavIconTile(props: {
  active: boolean;
  gradient: string;
  inactiveGradient: string;
  shadow: string;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden
      className={`[display:grid] [place-items:center] [width:28px] [height:28px] [border-radius:10px] [transition:transform_0.14s_ease,box-shadow_0.14s_ease] ${props.active ? "[transform:scale(1.06)]" : ""}`}
      style={{
        background: props.active ? props.gradient : props.inactiveGradient,
        boxShadow: props.active ? props.shadow : "none",
      }}
    >
      {props.children}
    </span>
  );
}

export function ChatsNavIcon(props: { active: boolean }) {
  return (
    <NavIconTile
      active={props.active}
      gradient="linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)"
      inactiveGradient="linear-gradient(135deg, #dbeafe 0%, #cffafe 100%)"
      shadow="0 4px 14px rgb(59 130 246 / 34%)"
    >
      <MessageCircle
        size={16}
        strokeWidth={2.25}
        className={props.active ? "[color:#ffffff]" : "[color:#2563eb]"}
      />
    </NavIconTile>
  );
}

export function AgentsNavIcon(props: { active: boolean }) {
  return (
    <NavIconTile
      active={props.active}
      gradient="linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)"
      inactiveGradient="linear-gradient(135deg, #ede9fe 0%, #fce7f3 100%)"
      shadow="0 4px 14px rgb(139 92 246 / 32%)"
    >
      <Bot
        size={16}
        strokeWidth={2.25}
        className={props.active ? "[color:#ffffff]" : "[color:#7c3aed]"}
      />
    </NavIconTile>
  );
}
