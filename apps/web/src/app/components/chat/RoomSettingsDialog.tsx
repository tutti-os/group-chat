import { useEffect, useRef, useState } from "react";
import { ImageUp, Trash2, X } from "lucide-react";
import type { Room, UpdateRoomRequest } from "@group-chat/shared";
import { isRoomImageAvatar, readRoomAvatarImageFile, ROOM_AVATAR_EMOJIS } from "../../room-avatar.js";
import { useTranslation } from "../../i18n/index.js";
import { RoomAvatar } from "../ui/RoomAvatar.js";

export function RoomSettingsDialog(props: {
  room: Room;
  onUpdateRoom: (roomId: string, input: UpdateRoomRequest) => Promise<unknown>;
  onDeleteRoom: () => void | Promise<void>;
  onPreviewChange?: (input: UpdateRoomRequest) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(props.room.title);
  const [avatar, setAvatar] = useState<string | null>(props.room.avatar);
  const [saving, setSaving] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const savedRef = useRef(false);
  const initialRoomRef = useRef({ title: props.room.title, avatar: props.room.avatar });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTitle(props.room.title);
    setAvatar(props.room.avatar);
    setUploadError(null);
    savedRef.current = false;
    initialRoomRef.current = { title: props.room.title, avatar: props.room.avatar };
  }, [props.room.id]);

  const syncPreview = (nextTitle: string, nextAvatar: string | null) => {
    props.onPreviewChange?.({
      title: nextTitle.trim() || props.room.title,
      avatar: nextAvatar?.trim() || null,
    });
  };

  const closeDialog = () => {
    if (!savedRef.current) {
      props.onPreviewChange?.({
        title: initialRoomRef.current.title,
        avatar: initialRoomRef.current.avatar,
      });
    }
    props.onClose();
  };

  const pickLocalAvatar = () => {
    setUploadError(null);
    fileInputRef.current?.click();
  };

  const handleAvatarFile = async (file: File | null) => {
    if (!file) return;
    try {
      const dataUrl = await readRoomAvatarImageFile(file);
      setAvatar(dataUrl);
      syncPreview(title, dataUrl);
      setUploadError(null);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : t("upload.failed"));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const save = async () => {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    const nextAvatar = avatar?.trim() || null;
    const initialTitle = initialRoomRef.current.title;
    const initialAvatar = initialRoomRef.current.avatar?.trim() || null;
    const unchanged = nextTitle === initialTitle && nextAvatar === initialAvatar;
    if (unchanged) {
      closeDialog();
      return;
    }
    setSaving(true);
    try {
      savedRef.current = true;
      await props.onUpdateRoom(props.room.id, {
        title: nextTitle,
        avatar: nextAvatar,
      });
      props.onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className={"[position:fixed] [inset:0] [z-index:60] [display:grid] [place-items:center] [background:rgb(0_0_0_/_46%)]"}
      aria-label={t("roomSettings.title")}
      onClick={closeDialog}
    >
      <div
        className={"[position:relative] [width:min(420px,_calc(100vw_-_32px))] [overflow:hidden] [border:1px_solid_#00000012] [border-radius:24px] [background:var(--panel)] [box-shadow:0_24px_80px_rgb(0_0_0_/_24%)]"}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className={"[position:absolute] [top:16px] [right:16px] [z-index:2] [display:inline-grid] [width:34px] [height:34px] [place-items:center] [border:0] [border-radius:999px] [color:var(--muted)] [background:transparent] [&:hover]:[color:var(--text)] [&:hover]:[background:#00000008]"}
          aria-label={t("common.close")}
          onClick={closeDialog}
        >
          <X size={18} />
        </button>
        <div className={"[padding:28px_24px_22px]"}>
          <h3 className={"[margin:0] [color:var(--text)] [font-size:18px] [font-weight:760]"}>{t("roomSettings.title")}</h3>
          <p className={"[margin:6px_0_0] [color:var(--muted)] [font-size:12px] [line-height:1.5]"}>{t("roomSettings.desc")}</p>
        </div>
        <div className={"[display:grid] [justify-items:center] [gap:10px] [padding:0_24px_18px]"}>
          <button
            type="button"
            className={"[display:grid] [justify-items:center] [gap:8px] [border:0] [padding:0] [background:transparent] [cursor:pointer] [&:hover]:[opacity:0.92]"}
            aria-label={t("roomSettings.uploadAvatar")}
            onClick={pickLocalAvatar}
          >
            <span className={"[position:relative] [display:inline-grid]"}>
              <RoomAvatar key={avatar ?? "default"} title={title || props.room.title} avatar={avatar} size={72} />
              <span className={"[position:absolute] [right:-2px] [bottom:-2px] [display:inline-grid] [width:24px] [height:24px] [place-items:center] [border-radius:999px] [color:#ffffff] [background:#171717] [box-shadow:0_2px_8px_rgb(0_0_0_/_18%)]"}>
                <ImageUp size={13} />
              </span>
            </span>
          </button>
          <div className={"[display:flex] [align-items:center] [justify-content:center]"}>
            <span className={"[color:var(--muted)] [font-size:12px]"}>{t("roomSettings.pickAvatar")}</span>
          </div>
          {uploadError ? <span className={"[color:var(--danger)] [font-size:12px]"}>{uploadError}</span> : null}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className={"[display:none]"}
            onChange={(event) => void handleAvatarFile(event.target.files?.[0] ?? null)}
          />
          <div className={"[display:grid] [grid-template-columns:repeat(6,_minmax(0,_1fr))] [gap:8px] [width:100%] [&_button]:[display:grid] [&_button]:[place-items:center] [&_button]:[height:42px] [&_button]:[border:1px_solid_var(--border)] [&_button]:[border-radius:12px] [&_button]:[background:#ffffff] [&_button]:[font-size:20px] [&_button]:[transition:border-color_0.12s_ease,_background-color_0.12s_ease,_box-shadow_0.12s_ease] [&_button:hover]:[border-color:var(--border-strong)] [&_button:focus-visible]:[outline:none]"}>
            {ROOM_AVATAR_EMOJIS.map((emoji) => {
              const selected = avatar === emoji;
              return (
                <button
                  key={emoji}
                  type="button"
                  aria-label={t("roomSettings.pickEmojiAvatar", { emoji })}
                  aria-pressed={selected}
                  className={selected ? "![border-color:#171717] ![background:#f7f7f8] [box-shadow:0_0_0_2px_#17171722]" : ""}
                  onClick={() => {
                    setUploadError(null);
                    setAvatar(emoji);
                    syncPreview(title, emoji);
                  }}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
          {isRoomImageAvatar(avatar) ? (
            <span className={"[color:var(--muted)] [font-size:11px]"}>{t("roomSettings.localImageHint")}</span>
          ) : null}
        </div>
        <div className={"[display:grid] [gap:8px] [padding:0_24px_24px] [&_label]:[display:grid] [&_label]:[gap:8px] [&_label_>_span]:[color:#5f6368] [&_label_>_span]:[font-size:12px] [&_label_>_span]:[font-weight:680] [&_input]:[width:100%] [&_input]:[height:44px] [&_input]:[border:1px_solid_var(--border-strong)] [&_input]:[border-radius:12px] [&_input]:[padding:0_13px] [&_input]:[color:var(--text)] [&_input]:[background:#f7f7f8] [&_input]:[outline:none] [&_input]:[font-size:13px]"}>
          <label>
            <span>{t("roomSettings.roomName")}</span>
            <input
              value={title}
              maxLength={64}
              disabled={saving}
              onChange={(event) => {
                const nextTitle = event.target.value;
                setTitle(nextTitle);
                syncPreview(nextTitle, avatar);
              }}
            />
          </label>
        </div>
        <div className={"[display:flex] [align-items:center] [justify-content:space-between] [gap:12px] [padding:0_24px_24px] [&_button]:[display:inline-flex] [&_button]:[align-items:center] [&_button]:[justify-content:center] [&_button]:[height:36px] [&_button]:[border:0] [&_button]:[border-radius:12px] [&_button]:[padding:0_14px] [&_button]:[font-size:13px] [&_button]:[font-weight:650]"}>
          <button type="button" className={"[gap:6px] [color:var(--danger)] [background:#dc26260d] [&:hover]:[background:#dc26261a]"} onClick={() => void props.onDeleteRoom()}>
            <Trash2 size={14} />
            {t("sidebar.deleteChat")}
          </button>
          <div className={"[display:flex] [gap:8px]"}>
            <button type="button" className={"[color:var(--text)] [background:#00000008] [&:hover]:[background:#00000012]"} onClick={closeDialog}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className={"[color:#ffffff] [background:var(--primary)] [&:hover]:[background:#111111ee] [&:disabled]:[opacity:0.55]"}
              disabled={saving || !title.trim()}
              onClick={() => void save()}
            >
              {saving ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
