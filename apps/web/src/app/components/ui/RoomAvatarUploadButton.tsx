import { useRef } from "react";
import { Camera } from "lucide-react";
import { readRoomAvatarImageFile } from "../../room-avatar.js";
import { AgentAvatar } from "./AgentAvatar.js";
import { RoomAvatar, type RoomAvatarSize } from "./RoomAvatar.js";

export function RoomAvatarUploadButton(props: {
  title: string;
  avatar?: string | null;
  provider?: string | null;
  size?: RoomAvatarSize;
  agent?: boolean;
  className?: string;
  onUpload: (avatar: string) => void;
  onError?: (message: string) => void;
}) {
  const size = props.size ?? 40;
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const iconSize = size <= 34 ? 16 : size <= 40 ? 18 : 22;

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await readRoomAvatarImageFile(file);
      props.onUpload(dataUrl);
    } catch (error) {
      props.onError?.(error instanceof Error ? error.message : "上传图片失败");
    }
  };

  return (
    <>
      <button
        type="button"
        className={`group [position:relative] [display:inline-grid] [border:0] [border-radius:999px] [padding:0] [background:transparent] [cursor:pointer] ${props.className ?? ""}`}
        aria-label="点击上传头像"
        title="点击上传头像"
        onClick={() => uploadRef.current?.click()}
      >
        {props.agent ? (
          <AgentAvatar
            key={`${props.avatar ?? "default"}:${props.provider ?? "none"}`}
            title={props.title}
            avatar={props.avatar}
            provider={props.provider}
            size={size}
          />
        ) : (
          <RoomAvatar
            key={`${props.avatar ?? "default"}:${props.provider ?? "none"}`}
            title={props.title}
            avatar={props.avatar}
            provider={props.provider}
            size={size}
          />
        )}
        <span
          className={"[pointer-events:none] [position:absolute] [inset:0] [display:grid] [place-items:center] [border-radius:999px] [background:rgb(0_0_0_/_52%)] [opacity:0] [transition:opacity_0.14s_ease] group-hover:[opacity:1] group-focus-visible:[opacity:1]"}
        >
          <Camera size={iconSize} strokeWidth={1.75} className={"[color:#ffffff]"} />
        </span>
      </button>
      <input
        ref={uploadRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className={"[display:none]"}
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </>
  );
}
