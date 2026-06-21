import { useEffect, useRef, useState } from "react";
import { ClipboardPaste } from "lucide-react";
import { useTranslation } from "../../i18n/index.js";

type EditableElement = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

function editableFromTarget(target: EventTarget | null): EditableElement | null {
  if (!(target instanceof Element)) return null;
  const editable = target.closest("input, textarea, [contenteditable]:not([contenteditable='false'])");
  if (!(editable instanceof HTMLElement)) return null;
  if ((editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) && (editable.disabled || editable.readOnly)) {
    return null;
  }
  return editable;
}

async function pasteInto(target: EditableElement) {
  target.focus();
  const text = await navigator.clipboard.readText();
  const clipboardData = new DataTransfer();
  clipboardData.setData("text/plain", text);
  const pasteEvent = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData });
  if (target.dispatchEvent(pasteEvent)) {
    document.execCommand("insertText", false, text);
  }
}

export function AppContextMenu() {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; target: EditableElement } | null>(null);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      const target = editableFromTarget(event.target);
      setMenu(target ? { x: event.clientX, y: event.clientY, target } : null);
    };
    const close = () => setMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  if (!menu) return null;
  return (
    <div
      ref={menuRef}
      role="menu"
      className="[position:fixed] [z-index:200] [min-width:136px] [border:1px_solid_var(--border)] [border-radius:10px] [padding:4px] [background:#fff] [box-shadow:0_12px_40px_rgb(0_0_0_/_14%)]"
      style={{
        left: Math.max(8, Math.min(menu.x, window.innerWidth - 152)),
        top: Math.max(8, Math.min(menu.y, window.innerHeight - 52)),
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        className="[display:flex] [width:100%] [align-items:center] [gap:8px] [border:0] [border-radius:7px] [padding:8px_10px] [color:var(--text)] [background:transparent] [font-size:13px] [text-align:left] [&:hover]:[background:#f3f4f6]"
        onClick={() => {
          const target = menu.target;
          setMenu(null);
          void pasteInto(target);
        }}
      >
        <ClipboardPaste size={15} />
        {t("common.paste")}
      </button>
    </div>
  );
}
