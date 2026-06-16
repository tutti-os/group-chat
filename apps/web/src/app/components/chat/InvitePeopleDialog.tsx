import { UserPlus } from "lucide-react";
import { useTranslation } from "../../i18n/index.js";

const TUTTI_URL = "https://tutti.sh/";

export function InvitePeopleDialog(props: {
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={"[position:fixed] [inset:0] [z-index:80] [display:grid] [place-items:center] [padding:24px] [background:rgb(15_23_42_/_52%)]"}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-people-title"
        aria-describedby="invite-people-desc"
        className={"[width:min(440px,_calc(100vw_-_32px))] [overflow:hidden] [border:1px_solid_var(--border)] [border-radius:18px] [background:var(--panel)] [box-shadow:0_24px_80px_rgb(0_0_0_/_24%)]"}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className={"[display:flex] [gap:12px] [padding:20px_20px_16px]"}>
          <div
            aria-hidden="true"
            className={"[display:grid] [width:28px] [height:28px] [flex-shrink:0] [place-items:center] [border-radius:999px] [background:#2563eb] [color:#ffffff]"}
          >
            <UserPlus size={16} strokeWidth={2.4} />
          </div>
          <div className={"[min-width:0]"}>
            <h3 id="invite-people-title" className={"[margin:0] [color:var(--text)] [font-size:16px] [font-weight:720] [line-height:1.35]"}>
              {t("invite.title")}
            </h3>
            <p id="invite-people-desc" className={"[margin:10px_0_0] [color:var(--muted)] [font-size:13px] [line-height:1.55]"}>
              {t("invite.desc")}
            </p>
            <p className={"[margin:10px_0_0] [color:var(--muted)] [font-size:13px] [line-height:1.55]"}>
              {t("invite.downloadHint")}{" "}
              <a
                href={TUTTI_URL}
                target="_blank"
                rel="noreferrer"
                className={"[color:#2563eb] [font-weight:650] [text-decoration:none] hover:[text-decoration:underline]"}
              >
                tutti.sh
              </a>
            </p>
          </div>
        </div>
        <div className={"[display:flex] [justify-content:flex-end] [gap:8px] [padding:0_20px_20px]"}>
          <button
            type="button"
            className={"[display:inline-flex] [height:36px] [align-items:center] [border:1px_solid_var(--border)] [border-radius:10px] [padding:0_14px] [color:var(--text)] [background:var(--panel)] [font-size:13px] [font-weight:650]"}
            onClick={props.onClose}
          >
            {t("common.gotIt")}
          </button>
          <a
            href={TUTTI_URL}
            target="_blank"
            rel="noreferrer"
            className={"[display:inline-flex] [height:36px] [align-items:center] [border:0] [border-radius:10px] [padding:0_14px] [color:#ffffff] [background:#2563eb] [font-size:13px] [font-weight:650] [text-decoration:none] hover:[background:#1d4ed8]"}
            onClick={props.onClose}
          >
            {t("invite.goToTutti")}
          </a>
        </div>
      </div>
    </div>
  );
}
