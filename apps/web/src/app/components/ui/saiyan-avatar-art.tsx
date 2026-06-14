import type { AvatarPresetId } from "../../user-profile.js";

export type SaiyanAvatarArt = {
  bg: string;
  skin: string;
  hair: string;
  eye: string;
  aura: string;
  spikes: 0 | 1 | 2 | 3;
  mood: "neutral" | "fierce" | "calm";
};

export const SAIYAN_AVATAR_ART: Record<AvatarPresetId, SaiyanAvatarArt> = {
  "saiyan-01": { bg: "#fff4d6", skin: "#f5c99a", hair: "#ffd54f", eye: "#1a2744", aura: "#ffe082", spikes: 0, mood: "fierce" },
  "saiyan-02": { bg: "#e3f2fd", skin: "#f0c095", hair: "#4fc3f7", eye: "#0d1b3d", aura: "#81d4fa", spikes: 1, mood: "neutral" },
  "saiyan-03": { bg: "#ffebee", skin: "#efb088", hair: "#ef5350", eye: "#3b0a0a", aura: "#ff8a80", spikes: 2, mood: "fierce" },
  "saiyan-04": { bg: "#e8f5e9", skin: "#e8b48c", hair: "#66bb6a", eye: "#1b3a1f", aura: "#a5d6a7", spikes: 3, mood: "calm" },
  "saiyan-05": { bg: "#f3e5f5", skin: "#f2bd93", hair: "#ab47bc", eye: "#2a1038", aura: "#ce93d8", spikes: 0, mood: "neutral" },
  "saiyan-06": { bg: "#fce4ec", skin: "#f5c4a0", hair: "#ec407a", eye: "#4a1028", aura: "#f48fb1", spikes: 1, mood: "fierce" },
  "saiyan-07": { bg: "#eceff1", skin: "#edd0b0", hair: "#cfd8dc", eye: "#263238", aura: "#ffffff", spikes: 2, mood: "calm" },
  "saiyan-08": { bg: "#fff3e0", skin: "#efb07a", hair: "#ff9800", eye: "#3e2723", aura: "#ffb74d", spikes: 3, mood: "fierce" },
  "saiyan-09": { bg: "#efebe9", skin: "#d9a574", hair: "#5d4037", eye: "#1b120e", aura: "#bcaaa4", spikes: 0, mood: "calm" },
  "saiyan-10": { bg: "#e0f7fa", skin: "#f0c095", hair: "#00acc1", eye: "#004d56", aura: "#4dd0e1", spikes: 1, mood: "neutral" },
  "saiyan-11": { bg: "#f9fbe7", skin: "#efb088", hair: "#c0ca33", eye: "#33691e", aura: "#dce775", spikes: 2, mood: "fierce" },
  "saiyan-12": { bg: "#ede7f6", skin: "#f2bd93", hair: "#7e57c2", eye: "#311b92", aura: "#b39ddb", spikes: 3, mood: "neutral" },
  "saiyan-13": { bg: "#fffde7", skin: "#f5c99a", hair: "#fbc02d", eye: "#f57f17", aura: "#fff176", spikes: 0, mood: "fierce" },
  "saiyan-14": { bg: "#e8eaf6", skin: "#e8b48c", hair: "#3949ab", eye: "#1a237e", aura: "#7986cb", spikes: 1, mood: "calm" },
  "saiyan-15": { bg: "#fafafa", skin: "#f0c095", hair: "#ff7043", eye: "#bf360c", aura: "#ffab91", spikes: 2, mood: "fierce" },
};

const HAIR_PATHS: Record<SaiyanAvatarArt["spikes"], string> = {
  0: "M32 8 C24 8 18 14 16 22 L12 18 L14 28 L8 24 L10 34 L6 30 L8 40 L14 36 L16 44 C20 38 26 34 32 34 C38 34 44 38 48 44 L50 36 L56 40 L58 30 L54 34 L56 24 L50 28 L52 18 L48 22 C46 14 40 8 32 8 Z",
  1: "M32 6 C22 6 14 12 12 20 L8 14 L10 26 L4 20 L6 32 L2 28 L4 42 L12 38 L14 46 C18 40 24 36 32 36 C40 36 46 40 50 46 L52 38 L60 42 L62 28 L58 32 L60 20 L54 26 L56 14 L52 20 C50 12 42 6 32 6 Z",
  2: "M32 7 C25 7 19 11 17 18 L13 12 L15 24 L9 18 L11 30 L7 26 L9 38 L15 34 L17 42 C21 37 26 35 32 35 C38 35 43 37 47 42 L49 34 L55 38 L57 26 L53 30 L55 18 L49 24 L51 12 L47 18 C45 11 39 7 32 7 Z",
  3: "M32 5 C21 5 12 11 10 19 L6 10 L8 24 L2 16 L4 30 L1 24 L3 40 L10 36 L12 45 C17 39 24 35 32 35 C40 35 47 39 52 45 L54 36 L61 40 L63 24 L59 30 L61 16 L55 24 L57 10 L54 19 C52 11 43 5 32 5 Z",
};

function eyePath(mood: SaiyanAvatarArt["mood"]) {
  if (mood === "fierce") return { left: "M22 30 L28 28 L28 32 Z", right: "M42 30 L36 28 L36 32 Z" };
  if (mood === "calm") return { left: "M22 30 Q25 28 28 30", right: "M36 30 Q39 28 42 30" };
  return { left: "M22 29 L28 29 L28 32 L22 32 Z", right: "M36 29 L42 29 L42 32 L36 32 Z" };
}

export function SaiyanAvatarSvg(props: { art: SaiyanAvatarArt; size?: number; className?: string; clipId?: string }) {
  const size = props.size ?? 64;
  const clipId = props.clipId ?? `saiyan-${props.art.hair}-${props.art.spikes}-${props.art.mood}`;
  const eyes = eyePath(props.art.mood);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={props.className}
      aria-hidden
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="32" cy="32" r="30" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect width="64" height="64" fill={props.art.bg} />
        <circle cx="32" cy="38" r="22" fill={props.art.aura} opacity="0.35" />
        <ellipse cx="32" cy="38" rx="14" ry="16" fill={props.art.skin} />
        <ellipse cx="32" cy="42" rx="8" ry="5" fill="#00000012" />
        <path d={HAIR_PATHS[props.art.spikes]} fill={props.art.hair} />
        <path d={eyes.left} fill={props.art.eye} />
        <path d={eyes.right} fill={props.art.eye} />
        {props.art.mood === "fierce" ? (
          <>
            <path d="M24 36 L30 35" stroke={props.art.eye} strokeWidth="1.5" strokeLinecap="round" />
            <path d="M40 36 L34 35" stroke={props.art.eye} strokeWidth="1.5" strokeLinecap="round" />
          </>
        ) : (
          <path d="M28 38 Q32 41 36 38" stroke="#00000033" strokeWidth="1.2" fill="none" strokeLinecap="round" />
        )}
        <ellipse cx="32" cy="24" rx="10" ry="4" fill={props.art.hair} opacity="0.55" />
      </g>
    </svg>
  );
}
