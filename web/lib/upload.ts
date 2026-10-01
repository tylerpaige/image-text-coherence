export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

function mimeOf(file: File): string | null {
  if (ALLOWED_TYPES.has(file.type)) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return (ext && MIME_BY_EXT[ext]) || null;
}

export type UploadedImage = {
  bytes: Uint8Array;
  mime: string;
};

export async function readImageField(
  form: FormData,
): Promise<UploadedImage | { error: string }> {
  const file = form.get("image");
  if (!(file instanceof File)) return { error: "MISSING IMAGE" };
  const mime = mimeOf(file);
  if (!mime) return { error: "USE A JPEG, PNG, WEBP, OR GIF" };
  if (file.size === 0) return { error: "EMPTY IMAGE" };
  if (file.size > MAX_IMAGE_BYTES) return { error: "IMAGE MUST BE 8MB OR SMALLER" };
  return { bytes: new Uint8Array(await file.arrayBuffer()), mime };
}

export function isUploadError(
  value: UploadedImage | { error: string },
): value is { error: string } {
  return "error" in value;
}
