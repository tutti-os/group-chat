import { UserPlus } from "lucide-react";
import { Button } from "@tutti-os/ui-system";
import { useTranslation } from "../../i18n/index.js";

const TUTTI_URL = "https://tutti.sh/";

export function InvitePeopleDialog(props: {
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={"[position:fixed] [inset:0] [z-index:80] [display:grid] [place-items:center] [padding:24px] [background:color-mix(in_srgb,var(--black-stationary)_52%,transparent)]"}
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
        className={"[width:min(440px,_calc(100vw_-_32px))] [overflow:hidden] [border:1px_solid_var(--border-1)] [border-radius:16px] [background:var(--background-fronted)] [box-shadow:0_24px_80px_color-mix(in_srgb,var(--black-stationary)_24%,transparent)]"}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className={"[display:flex] [gap:12px] [padding:20px_20px_16px]"}>
          <div
            aria-hidden="true"
            className={"[display:grid] [width:28px] [height:28px] [flex-shrink:0] [place-items:center] [border-radius:999px] [background:var(--tutti-purple)] [color:var(--white-stationary)]"}
          >
            <UserPlus size={16} strokeWidth={2.4} />
          </div>
          <div className={"[min-width:0]"}>
            <h3 id="invite-people-title" className={"[margin:0] [color:var(--text-primary)] [font-size:15px] [font-weight:720] [line-height:1.35]"}>
              {t("invite.title")}
            </h3>
            <p id="invite-people-desc" className={"[margin:10px_0_0] [color:var(--text-secondary)] [font-size:13px] [line-height:1.55]"}>
              {t("invite.desc")}
            </p>
            <p className={"[margin:10px_0_0] [color:var(--text-secondary)] [font-size:13px] [line-height:1.55]"}>
              {t("invite.downloadHint")}{" "}
              <a
                href={TUTTI_URL}
                target="_blank"
                rel="noreferrer"
                className={"[color:var(--tutti-purple)] [font-weight:650] [text-decoration:none] hover:[text-decoration:none]"}
              >
                tutti.sh
              </a>
            </p>
          </div>
        </div>
        <div className={"[display:flex] [justify-content:flex-end] [gap:8px] [padding:0_20px_20px]"}>
          <Button
            type="button"
            variant="secondary"
            size="dialog"
            onClick={props.onClose}
          >
            {t("common.gotIt")}
          </Button>
          <Button
            asChild
            variant="default"
            size="dialog"
            className={"[text-decoration:none] hover:[text-decoration:none]"}
          >
            <a
              href={TUTTI_URL}
              target="_blank"
              rel="noreferrer"
              className={"[text-decoration:none] hover:[text-decoration:none] focus-visible:[text-decoration:none]"}
              onClick={props.onClose}
            >
              {t("invite.goToTutti")}
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
