import { useEffect, useState } from "react";
import { Bot, Info, SlidersHorizontal, UserRound, X } from "lucide-react";
import type { LocalAgentProviderStatus, RuntimeProfile } from "@group-chat/shared";
import {
  type LocalUserProfile,
} from "../../user-profile.js";
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
    { id: "account", label: "账号", icon: UserRound },
    { id: "general", label: "通用", icon: SlidersHorizontal },
    { id: "models", label: "模型", icon: Bot },
    { id: "about", label: "关于", icon: Info },
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
    <section className={"[position:fixed] [inset:0] [z-index:55] [display:grid] [place-items:center] [background:rgb(0_0_0_/_46%)]"} aria-label="Settings">
      <div className={"[position:relative] [display:grid] [grid-template-columns:232px_minmax(0,_1fr)] [width:min(980px,_calc(100vw_-_96px))] [height:min(720px,_calc(100vh_-_88px))] [overflow:hidden] [border:1px_solid_#00000012] [border-radius:28px] [background:var(--panel)] [box-shadow:0_24px_80px_rgb(0_0_0_/_24%)] max-[760px]:[grid-template-columns:1fr] max-[760px]:[width:calc(100vw_-_28px)] max-[760px]:[height:calc(100vh_-_28px)]"}>
        <button
          type="button"
          className={"[position:absolute] [top:20px] [right:20px] [z-index:2] [display:inline-grid] [width:34px] [height:34px] [place-items:center] [border:0] [border-radius:999px] [color:var(--muted)] [background:transparent] [&:hover]:[color:var(--text)] [&:hover]:[background:#00000008]"}
          aria-label="Close settings"
          title="Close"
          onClick={props.onClose}
        >
          <X size={18} />
        </button>
        <aside className={"[display:grid] [align-content:start] [gap:6px] [border-right:1px_solid_var(--border)] [padding:28px_14px_0] [background:#fbfbfc] [&_h2]:[margin:0_0_20px] [&_h2]:[padding:0_10px] [&_h2]:[color:var(--text)] [&_h2]:[font-size:17px] [&_h2]:[font-weight:760] [&_button]:[display:flex] [&_button]:[height:42px] [&_button]:[align-items:center] [&_button]:[gap:12px] [&_button]:[border:1px_solid_transparent] [&_button]:[border-radius:14px] [&_button]:[padding:0_12px] [&_button]:[color:#5f6368] [&_button]:[background:transparent] [&_button]:[font-size:14px] [&_button]:[font-weight:620] [&_button]:[transition:background-color_0.14s_ease,_color_0.14s_ease,_border-color_0.14s_ease] [&_button:hover]:[background:#00000007] max-[760px]:[display:none]"}>
          <h2>设置</h2>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? "![border-color:#00000014] ![color:var(--text)] ![background:#ffffff] ![box-shadow:0_8px_22px_rgb(0_0_0_/_7%),_0_1px_1px_rgb(0_0_0_/_5%)]" : ""}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={19} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </aside>
        <main className={"[min-width:0] [overflow:auto] [padding:54px_42px_30px] [&_h3]:[margin:0] [&_h3]:[color:var(--text)] [&_h3]:[font-size:18px] [&_h3]:[font-weight:760] max-[760px]:[padding:42px_20px_24px]"}>
          {activeTab === "account" ? (
            <section className={"[min-height:430px]"}>
              <div className={"[display:flex] [align-items:flex-start] [justify-content:space-between] [gap:24px] [padding-right:34px]"}>
                <div className={"[display:grid] [gap:6px]"}>
                  <h3>账号</h3>
                  <p className={"[margin:0] [color:var(--muted)] [font-size:13px] [line-height:1.5]"}>本地工作区身份信息，仅用于当前设备展示。</p>
                </div>
                <span className={"[display:inline-grid] [width:78px] [height:78px] [flex:0_0_auto] [place-items:center] [border:1px_solid_var(--border)] [border-radius:999px] [background:#fff7f0] [box-shadow:inset_0_0_0_6px_#ffffff]"}>
                  <AvatarUploadButton
                    size={58}
                    preset={draftProfile.avatarPreset}
                    customAvatarUrl={draftProfile.customAvatarUrl}
                    onUpload={(customAvatarUrl) => setDraftProfile((current) => ({ ...current, customAvatarUrl }))}
                  />
                </span>
              </div>

              <div className={"[margin-top:28px] [display:grid] [gap:22px]"}>
                <section className={"[display:grid] [grid-template-columns:128px_minmax(0,_1fr)] [gap:18px_28px] [align-items:start] [border-top:1px_solid_var(--border)] [padding-top:22px] max-[760px]:[grid-template-columns:1fr]"}>
                  <div>
                    <h4 className={"[margin:0_0_6px] [color:var(--text)] [font-size:14px] [font-weight:720]"}>基础信息</h4>
                    <p className={"[margin:0] [color:var(--muted)] [font-size:12px] [line-height:1.45]"}>名称、邮箱和简介。</p>
                  </div>
                  <div className={"[display:grid] [grid-template-columns:1fr_1fr] [gap:16px] [&_label]:[display:grid] [&_label]:[gap:8px] [&_label_>_span]:[color:#5f6368] [&_label_>_span]:[font-size:12px] [&_label_>_span]:[font-weight:680] [&_input]:[width:100%] [&_input]:[height:44px] [&_input]:[border:1px_solid_var(--border-strong)] [&_input]:[border-radius:12px] [&_input]:[padding:0_13px] [&_input]:[color:var(--text)] [&_input]:[background:#f7f7f8] [&_input]:[outline:none] [&_input]:[font-size:13px] [&_textarea]:[width:100%] [&_textarea]:[min-height:84px] [&_textarea]:[border:1px_solid_var(--border-strong)] [&_textarea]:[border-radius:12px] [&_textarea]:[padding:13px] [&_textarea]:[color:var(--text)] [&_textarea]:[background:#f7f7f8] [&_textarea]:[outline:none] [&_textarea]:[font-size:13px] [&_textarea]:[line-height:1.5] [&_textarea]:[resize:none] max-[900px]:[grid-template-columns:1fr]"}>
                    <label>
                      <span>名称</span>
                      <input
                        value={draftProfile.displayName}
                        onChange={(event) => setDraftProfile((current) => ({ ...current, displayName: event.target.value }))}
                      />
                    </label>
                    <label>
                      <span>邮箱</span>
                      <input value="local@workspace" readOnly />
                    </label>
                    <label className={"[grid-column:1_/_-1]"}>
                      <span>简介</span>
                      <textarea
                        value={draftProfile.bio}
                        onChange={(event) => setDraftProfile((current) => ({ ...current, bio: event.target.value }))}
                      />
                    </label>
                  </div>
                </section>

                <section className={"[display:grid] [grid-template-columns:128px_minmax(0,_1fr)] [gap:18px_28px] [align-items:start] [border-top:1px_solid_var(--border)] [padding-top:22px] max-[760px]:[grid-template-columns:1fr]"}>
                  <div>
                    <h4 className={"[margin:0_0_6px] [color:var(--text)] [font-size:14px] [font-weight:720]"}>头像</h4>
                    <p className={"[margin:0] [color:var(--muted)] [font-size:12px] [line-height:1.45]"}>选择一个工作区头像。</p>
                  </div>
                  <AvatarPicker
                    profile={draftProfile}
                    onChange={(next) => setDraftProfile((current) => ({ ...current, ...next }))}
                  />
                </section>

              </div>

              <div className={"[position:sticky] [bottom:-30px] [display:flex] [justify-content:flex-end] [margin:28px_-42px_-30px] [border-top:1px_solid_var(--border)] [padding:16px_42px] [background:linear-gradient(180deg,_rgb(255_255_255_/_82%),_#ffffff)] [backdrop-filter:blur(10px)] max-[760px]:[margin:24px_-20px_-24px] max-[760px]:[padding:14px_20px]"}>
                <button className={"[display:inline-flex] [height:38px] [align-items:center] [justify-content:center] [border:0] [border-radius:13px] [padding:0_16px] [color:var(--primary-contrast)] [background:var(--primary)] [font-size:13px] [font-weight:700] [&:disabled]:[opacity:0.5]"} type="button" onClick={saveProfile}>
                  保存
                </button>
              </div>
            </section>
          ) : null}

          {activeTab === "general" ? (
            <section className={"[min-height:430px]"}>
              <h3>通用</h3>
              <div data-slot="message-meta" className={"[&_span]:[color:var(--muted)] [&_span]:[font-size:12px] [display:flex] [min-height:58px] [align-items:center] [justify-content:space-between] [gap:18px] [border-bottom:1px_solid_var(--border)] [padding:12px_0] [&_strong]:[display:block] [&_strong]:[color:var(--text)] [&_strong]:[font-size:14px] [&_strong]:[font-weight:650] [&_div_span]:[display:block] [&_div_span]:[margin-top:4px]"}>
                <div>
                  <strong>界面语言</strong>
                  <span>跟随 Nextop / 浏览器环境</span>
                </div>
                <span>自动</span>
              </div>
              <div data-slot="message-meta" className={"[&_span]:[color:var(--muted)] [&_span]:[font-size:12px] [display:flex] [min-height:58px] [align-items:center] [justify-content:space-between] [gap:18px] [border-bottom:1px_solid_var(--border)] [padding:12px_0] [&_strong]:[display:block] [&_strong]:[color:var(--text)] [&_strong]:[font-size:14px] [&_strong]:[font-weight:650] [&_div_span]:[display:block] [&_div_span]:[margin-top:4px]"}>
                <div>
                  <strong>工作区</strong>
                  <span>文件引用、上传和运行数据保存在本地工作区</span>
                </div>
                <span>本地</span>
              </div>
            </section>
          ) : null}

          {activeTab === "models" ? (
            <section className={"[min-height:430px]"}>
              <div className={"[display:flex] [align-items:center] [justify-content:space-between] [gap:18px] [margin-bottom:22px] [&_h3]:[margin:0] [&_span]:[color:var(--muted)] [&_span]:[font-size:12px]"}>
                <div>
                  <h3>模型</h3>
                  <span>
                    {readyLocalCount}/{localRuntimeCount} 本地 Agent 可用
                  </span>
                </div>
              </div>
              <div className={"[display:grid] [gap:4px]"}>
                {props.runtimeProfiles.map((profile) => {
                  const status = localAgentStatus(profile, props.localAgentProviders);
                  return (
                    <article key={profile.id} className={`[display:grid] [grid-template-columns:minmax(0,_1fr)_minmax(180px,_auto)] [gap:8px_12px] [border:0] [border-radius:14px] [padding:11px] [background:transparent] [&:hover]:[background:var(--sidebar-hover)] [&_strong]:[display:block] [&_strong]:[color:var(--text)] [&_strong]:[font-size:14px] [&_strong]:[font-weight:650] [&_span]:[display:block] [&_span]:[color:var(--muted)] [&_span]:[font-size:12px] [&_small]:[display:block] [&_small]:[color:var(--muted)] [&_small]:[font-size:12px] [&_small]:[grid-column:1_/_-1] max-[760px]:[grid-template-columns:1fr] ${profile.enabled ? "" : "[opacity:0.62]"}`}>
                      <div>
                        <strong>{profile.displayName}</strong>
                        <span>
                          {profile.kind} · {profile.provider} · {profile.model}
                        </span>
                      </div>
                      <RuntimeStatusHint profile={profile} localAgentProviders={props.localAgentProviders} />
                      <small>
                        {profile.enabled ? "已启用" : "已停用"} · {profile.trustedMode ? "可信" : "标准"} ·{" "}
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
              <h3>关于</h3>
              <div data-slot="message-meta" className={"[&_span]:[color:var(--muted)] [&_span]:[font-size:12px] [display:flex] [min-height:58px] [align-items:center] [justify-content:space-between] [gap:18px] [border-bottom:1px_solid_var(--border)] [padding:12px_0] [&_strong]:[display:block] [&_strong]:[color:var(--text)] [&_strong]:[font-size:14px] [&_strong]:[font-weight:650] [&_div_span]:[display:block] [&_div_span]:[margin-top:4px]"}>
                <div>
                  <strong>Group Chat</strong>
                  <span>Nextop 本地 Agent 群聊应用</span>
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
