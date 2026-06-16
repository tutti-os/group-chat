import { t } from "./i18n/index.js";

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const OUTPUT_SIZE = 128;

export async function readAvatarUpload(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error(t("upload.pickImage"));
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error(t("upload.imageTooLarge5mb"));
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(t("upload.processFailed"));

    const side = Math.min(image.width, image.height);
    const sx = (image.width - side) / 2;
    const sy = (image.height - side) / 2;
    context.drawImage(image, sx, sy, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    return canvas.toDataURL("image/jpeg", 0.86);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(t("upload.readFailed")));
    image.src = src;
  });
}
