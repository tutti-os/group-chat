import { useEffect, useState } from "react";
import { Bot, Info, SlidersHorizontal, UserRound, X } from "lucide-react";
import type { LocalAgentProviderStatus, RuntimeProfile } from "@group-chat/shared";
import {
  type LocalUserProfile,
} from "../../user-profile.js";
import { useTranslation } from "../../i18n/index.js";
import { LocalAgentProvidersPanel, localAgentStatus, RuntimeStatusHint } from "../../runtime.js";
import { AvatarPicker } from "../ui/AvatarPicker.js";
import { AvatarUploadButton } from "../ui/AvatarUploadButton.js";

export function SettingsDialog(props: {
  runtimeProfiles: RuntimeProfile[];
  localAgentProviders: LocalAgentProviderStatus[];
  localAgentProvidersRefreshing: boolean;
  onRefreshLocalAgentProviders: () => Promise<void>;
  userProfile: LocalUserProfile;
  onSaveProfile: (profile: LocalUserProfile) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"account" | "general" | "models" | "about">("account");
  const [draftProfile, setDraftProfile] = useState<LocalUserProfile>(props.userProfile);

  useEffect(() => {
    setDraftProfile(props.userProfile);
  }, [props.userProfile]);

  const localRuntimeCount = props.runtimeProfiles.filter((profile) => profile.kind === "local-agent").length;
  const readyLocalCount = props.runtimeProfiles.filter((profile) => {
    const status = localAgentStatus(profile, props.localAgentProviders);
    return profile.kind === "local-agent" && status?.available;
  }).length;
  const tabs = [
    { id: "account", label: t("settings.tab.account"), icon: UserRound },
    { id: "general", label: t("settings.tab.general"), icon: SlidersHorizontal },
    { id: "models", label: t("settings.tab.models"), icon: Bot },
    { id: "about", label: t("settings.tab.about"), icon: Info },
  ] as const;

  const saveProfile = () => {
    const nextProfile: LocalUserProfile = {
      displayName: draftProfile.displayName.trim() || props.userProfile.displayName,
      avatarPreset: draftProfile.avatarPreset,
      customAvatarUrl: draftProfile.customAvatarUrl,
      bio: draftProfile.bio.trim() || props.userProfile.bio,
    };
    props.onSaveProfile(nextProfile);
    props.onClose();
  };

  return (
    <section className={"[position:fixed] [inset:0] [z-index:55] [display:grid] [place-items:center] [background:color-mix(in_srgb,var(--black-stationary)_46%,transparent)]"} aria-label={t("settings.title")}>
      <div className={"[position:relative] [display:grid] [grid-template-columns:232px_minmax(0,_1fr)] [width:min(980px,_calc(100vw_-_96px))] [height:min(720px,_calc(100vh_-_88px))] [overflow:hidden] [border:1px_solid_var(--line-focus-window)] [border-radius:16px] [background:var(--background-fronted)] [box-shadow:0_24px_80px_color-mix(in_srgb,var(--black-stationary)_24%,transparent)] max-[760px]:[grid-template-columns:1fr] max-[760px]:[width:calc(100vw_-_28px)] max-[760px]:[height:calc(100vh_-_28px)]"}>
        <button
          type="button"
          className={"dialog-close-button [position:absolute] [top:20px] [right:20px] [z-index:2] [display:inline-grid] [width:34px] [height:34px] [place-items:center] [border:0] [border-radius:999px] [color:var(--text-secondary)] [background:transparent] [&:hover]:[color:var(--text-primary)] [&:hover]:[background:var(--transparency-hover)]"}
          aria-label={t("settings.close")}
          title={t("common.close")}
          onClick={props.onClose}
        >
          <X size={18} />
        </button>
        <aside className={"[display:grid] [align-content:start] [gap:6px] [border-right:1px_solid_var(--border-1)] [padding:28px_14px_0] [background:var(--background-panel)] [&_h2]:[margin:0_0_20px] [&_h2]:[padding:0_10px] [&_h2]:[color:var(--text-primary)] [&_h2]:[font-size:15px] [&_h2]:[font-weight:760] [&_button]:[display:flex] [&_button]:[height:42px] [&_button]:[align-items:center] [&_button]:[gap:12px] [&_button]:[border:1px_solid_transparent] [&_button]:[border-radius:14px] [&_button]:[padding:0_12px] [&_button]:[color:var(--text-secondary)] [&_button]:[background:transparent] [&_button]:[font-size:13px] [&_button]:[font-weight:620] [&_button]:[transition:background-color_0.14s_ease,_color_0.14s_ease,_border-color_0.14s_ease] [&_button:hover]:[background:var(--transparency-block)] max-[760px]:[display:none]"}>
          <h2>{t("settings.title")}</h2>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? "![border-color:var(--line-focus-window)] ![color:var(--text-primary)] ![background:var(--white-stationary)] ![box-shadow:0_8px_22px_color-mix(in_srgb,var(--black-stationary)_7%,transparent),_0_1px_1px_color-mix(in_srgb,var(--black-stationary)_5%,transparent)]" : ""}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={19} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </aside>
        <main className={"[min-width:0] [overflow:auto] [padding:54px_42px_30px] [&_h3]:[margin:0] [&_h3]:[color:var(--text-primary)] [&_h3]:[font-size:15px] [&_h3]:[font-weight:760] max-[760px]:[padding:42px_20px_24px]"}>
          {activeTab === "account" ? (
            <section className={"[min-height:430px]"}>
              <div className={"[display:flex] [align-items:flex-start] [justify-content:space-between] [gap:24px] [padding-right:34px]"}>
                <div className={"[display:grid] [gap:6px]"}>
                  <h3>{t("settings.account.title")}</h3>
                  <p className={"[margin:0] [color:var(--text-secondary)] [font-size:13px] [line-height:1.5]"}>{t("settings.account.desc")}</p>
                </div>
                <span className={"[display:inline-grid] [width:78px] [height:78px] [flex:0_0_auto] [place-items:center] [border:1px_solid_var(--border-1)] [border-radius:999px] [background:color-mix(in_srgb,var(--state-warning)_10%,var(--background-fronted))] [box-shadow:inset_0_0_0_6px_var(--white-stationary)]"}>
                  <AvatarUploadButton
                    size={58}
                    preset={draftProfile.avatarPreset}
                    customAvatarUrl={draftProfile.customAvatarUrl}
                    onUpload={(customAvatarUrl) => setDraftProfile((current) => ({ ...current, customAvatarUrl }))}
                  />
                </span>
              </div>

              <div className={"[margin-top:28px] [display:grid] [gap:22px]"}>
                <section className={"[display:grid] [grid-template-columns:128px_minmax(0,_1fr)] [gap:18px_28px] [align-items:start] [border-top:1px_solid_var(--border-1)] [padding-top:22px] max-[760px]:[grid-template-columns:1fr]"}>
                  <div>
                    <h4 className={"[margin:0_0_6px] [color:var(--text-primary)] [font-size:13px] [font-weight:720]"}>{t("settings.account.basicInfo")}</h4>
                    <p className={"[margin:0] [color:var(--text-secondary)] [font-size:11px] [line-height:1.45]"}>{t("settings.account.basicDesc")}</p>
                  </div>
                  <div className={"[display:grid] [grid-template-columns:1fr_1fr] [gap:16px] [&_label]:[display:grid] [&_label]:[gap:8px] [&_label_>_span]:[color:var(--text-secondary)] [&_label_>_span]:[font-size:11px] [&_label_>_span]:[font-weight:680] [&_input]:[width:100%] [&_input]:[height:44px] [&_input]:[border:1px_solid_var(--line-focus-window)] [&_input]:[border-radius:12px] [&_input]:[padding:0_13px] [&_input]:[color:var(--text-primary)] [&_input]:[background:var(--background-panel)] [&_input]:[outline:none] [&_input]:[font-size:13px] [&_textarea]:[width:100%] [&_textarea]:[min-height:84px] [&_textarea]:[border:1px_solid_var(--line-focus-window)] [&_textarea]:[border-radius:12px] [&_textarea]:[padding:13px] [&_textarea]:[color:var(--text-primary)] [&_textarea]:[background:var(--background-panel)] [&_textarea]:[outline:none] [&_textarea]:[font-size:13px] [&_textarea]:[line-height:1.5] [&_textarea]:[resize:none] max-[900px]:[grid-template-columns:1fr]"}>
                    <label>
                      <span>{t("settings.account.name")}</span>
                      <input
                        value={draftProfile.displayName}
                        onChange={(event) => setDraftProfile((current) => ({ ...current, displayName: event.target.value }))}
                      />
                    </label>
                    <label>
                      <span>{t("settings.account.email")}</span>
                      <input value="local@workspace" readOnly />
                    </label>
                    <label className={"[grid-column:1_/_-1]"}>
                      <span>{t("settings.account.bio")}</span>
                      <textarea
                        value={draftProfile.bio}
                        onChange={(event) => setDraftProfile((current) => ({ ...current, bio: event.target.value }))}
                      />
                    </label>
                  </div>
                </section>

                <section className={"[display:grid] [grid-template-columns:128px_minmax(0,_1fr)] [gap:18px_28px] [align-items:start] [border-top:1px_solid_var(--border-1)] [padding-top:22px] max-[760px]:[grid-template-columns:1fr]"}>
                  <div>
                    <h4 className={"[margin:0_0_6px] [color:var(--text-primary)] [font-size:13px] [font-weight:720]"}>{t("settings.account.avatar")}</h4>
                    <p className={"[margin:0] [color:var(--text-secondary)] [font-size:11px] [line-height:1.45]"}>{t("settings.account.avatarDesc")}</p>
                  </div>
                  <AvatarPicker
                    profile={draftProfile}
                    onChange={(next) => setDraftProfile((current) => ({ ...current, ...next }))}
                  />
                </section>

              </div>

              <div className={"[position:sticky] [bottom:-30px] [display:flex] [justify-content:flex-end] [margin:28px_-42px_-30px] [border-top:1px_solid_var(--border-1)] [padding:16px_42px] [background:linear-gradient(180deg,_color-mix(in_srgb,var(--white-stationary)_82%,transparent),_var(--white-stationary))] [backdrop-filter:blur(10px)] max-[760px]:[margin:24px_-20px_-24px] max-[760px]:[padding:14px_20px]"}>
                <button className={"[display:inline-flex] [height:38px] [align-items:center] [justify-content:center] [border:0] [border-radius:13px] [padding:0_16px] [color:var(--white-stationary)] [background:var(--black-stationary)] [font-size:13px] [font-weight:700] [&:disabled]:[opacity:0.5]"} type="button" onClick={saveProfile}>
                  {t("common.save")}
                </button>
              </div>
            </section>
          ) : null}

          {activeTab === "general" ? (
            <section className={"[min-height:430px]"}>
              <h3>{t("settings.tab.general")}</h3>
              <div data-slot="message-meta" className={"[&_span]:[color:var(--text-secondary)] [&_span]:[font-size:11px] [display:flex] [min-height:58px] [align-items:center] [justify-content:space-between] [gap:18px] [border-bottom:1px_solid_var(--border-1)] [padding:12px_0] [&_strong]:[display:block] [&_strong]:[color:var(--text-primary)] [&_strong]:[font-size:13px] [&_strong]:[font-weight:650] [&_div_span]:[display:block] [&_div_span]:[margin-top:4px]"}>
                <div>
                  <strong>{t("settings.general.language")}</strong>
                  <span>{t("settings.general.languageHint")}</span>
                </div>
                <span>{t("settings.general.languageAuto")}</span>
              </div>
              <div data-slot="message-meta" className={"[&_span]:[color:var(--text-secondary)] [&_span]:[font-size:11px] [display:flex] [min-height:58px] [align-items:center] [justify-content:space-between] [gap:18px] [border-bottom:1px_solid_var(--border-1)] [padding:12px_0] [&_strong]:[display:block] [&_strong]:[color:var(--text-primary)] [&_strong]:[font-size:13px] [&_strong]:[font-weight:650] [&_div_span]:[display:block] [&_div_span]:[margin-top:4px]"}>
                <div>
                  <strong>{t("settings.general.workspace")}</strong>
                  <span>{t("settings.general.workspaceHint")}</span>
                </div>
                <span>{t("settings.general.workspaceLocal")}</span>
              </div>
            </section>
          ) : null}

          {activeTab === "models" ? (
            <section className={"[min-height:430px]"}>
              <div className={"[display:flex] [align-items:center] [justify-content:space-between] [gap:18px] [margin-bottom:22px] [&_h3]:[margin:0] [&_span]:[color:var(--text-secondary)] [&_span]:[font-size:11px]"}>
                <div>
                  <h3>{t("settings.models.title")}</h3>
                  <span>
                    {t("settings.models.available", { ready: readyLocalCount, total: localRuntimeCount })}
                  </span>
                </div>
              </div>
              <div className={"[display:grid] [gap:4px]"}>
                {props.runtimeProfiles.map((profile) => {
                  const status = localAgentStatus(profile, props.localAgentProviders);
                  return (
                    <article key={profile.id} className={`[display:grid] [grid-template-columns:minmax(0,_1fr)_minmax(180px,_auto)] [gap:8px_12px] [border:0] [border-radius:14px] [padding:11px] [background:transparent] [&:hover]:[background:var(--transparency-hover)] [&_strong]:[display:block] [&_strong]:[color:var(--text-primary)] [&_strong]:[font-size:13px] [&_strong]:[font-weight:650] [&_span]:[display:block] [&_span]:[color:var(--text-secondary)] [&_span]:[font-size:11px] [&_small]:[display:block] [&_small]:[color:var(--text-secondary)] [&_small]:[font-size:11px] [&_small]:[grid-column:1_/_-1] max-[760px]:[grid-template-columns:1fr] ${profile.enabled ? "" : "[opacity:0.62]"}`}>
                      <div>
                        <strong>{profile.displayName}</strong>
                        <span>
                          {profile.kind} · {profile.provider} · {profile.model}
                        </span>
                      </div>
                      <RuntimeStatusHint profile={profile} localAgentProviders={props.localAgentProviders} />
                      <small>
                        {profile.enabled ? t("settings.models.enabled") : t("settings.models.disabled")} · {profile.trustedMode ? t("settings.models.trusted") : t("settings.models.standard")} ·{" "}
                        {status?.authState ?? profile.systemPromptMode}
                      </small>
                    </article>
                  );
                })}
              </div>
              <LocalAgentProvidersPanel
                runtimeProfiles={props.runtimeProfiles}
                localAgentProviders={props.localAgentProviders}
                refreshing={props.localAgentProvidersRefreshing}
                onRefresh={props.onRefreshLocalAgentProviders}
              />
            </section>
          ) : null}

          {activeTab === "about" ? (
            <section className={"[min-height:430px]"}>
              <h3>{t("settings.tab.about")}</h3>
              <div data-slot="message-meta" className={"[&_span]:[color:var(--text-secondary)] [&_span]:[font-size:11px] [display:flex] [min-height:58px] [align-items:center] [justify-content:space-between] [gap:18px] [border-bottom:1px_solid_var(--border-1)] [padding:12px_0] [&_strong]:[display:block] [&_strong]:[color:var(--text-primary)] [&_strong]:[font-size:13px] [&_strong]:[font-weight:650] [&_div_span]:[display:block] [&_div_span]:[margin-top:4px]"}>
                <div>
                  <strong>{t("settings.about.appName")}</strong>
                  <span>{t("settings.about.description")}</span>
                </div>
                <span>0.1.0</span>
              </div>
            </section>
          ) : null}
        </main>
      </div>
    </section>
  );
}
