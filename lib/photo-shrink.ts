// Runs in the browser (phones, tablets, computers): shrink a Farm Vision photo to what the vision model can see.
import { JPEG_QUALITY, MAX_EDGE, targetSize } from "@/lib/photo-size.mjs";

export type ShrinkResult = { file: File; shrunk: boolean; from: number; to: number; width?: number; height?: number };

/**
 * A copy of the photo at most MAX_EDGE pixels on the long side, as a high-quality JPEG, turned the right way up.
 * The original is sent instead if the browser cannot do this, if the photo is already small, if it is a GIF, or if the
 * copy would not be smaller. It never fails: the worst case is the original upload.
 */
export async function shrinkPhoto(file: File): Promise<ShrinkResult> {
  const unchanged: ShrinkResult = { file, shrunk: false, from: file.size, to: file.size };
  if (file.type === "image/gif" || typeof createImageBitmap !== "function") return unchanged;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const size = targetSize(bitmap.width, bitmap.height, file.size, MAX_EDGE);
    if (!size) return unchanged;
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return unchanged;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    canvas.width = canvas.height = 0;
    if (!blob || blob.size >= file.size) return unchanged;
    const name = file.name.replace(/\.[A-Za-z0-9]+$/, "") + ".jpg";
    return { file: new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified }), shrunk: true, from: file.size, to: blob.size, ...size };
  } catch {
    return unchanged;
  } finally {
    bitmap?.close();
  }
}

export function sizeLabel(bytes: number) {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}
