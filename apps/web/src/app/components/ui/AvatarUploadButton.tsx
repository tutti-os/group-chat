import { useRef } from "react";
import { Camera } from "lucide-react";
import { readAvatarUpload } from "../../avatar-upload.js";
import type { AvatarPresetId } from "../../user-profile.js";
import { UserAvatar, type UserAvatarSize } from "./UserAvatar.js";

export function AvatarUploadButton(props: {
  size?: UserAvatarSize;
  preset: AvatarPresetId;
  customAvatarUrl?: string | null;
  onUpload: (customAvatarUrl: string) => void;
  className?: string;
}) {
  const size = props.size ?? 58;
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const iconSize = size <= 40 ? 18 : size <= 48 ? 20 : 24;

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const customAvatarUrl = await readAvatarUpload(file);
      props.onUpload(customAvatarUrl);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "上传失败");
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
        <UserAvatar size={size} preset={props.preset} customAvatarUrl={props.customAvatarUrl} />
        <span
          className={"[pointer-events:none] [position:absolute] [inset:0] [display:grid] [place-items:center] [border-radius:999px] [background:rgb(0_0_0_/_52%)] [opacity:0] [transition:opacity_0.14s_ease] group-hover:[opacity:1] group-focus-visible:[opacity:1]"}
        >
          <Camera size={iconSize} strokeWidth={1.75} className={"[color:#ffffff]"} />
        </span>
      </button>
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        className={"[display:none]"}
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </>
  );
}
