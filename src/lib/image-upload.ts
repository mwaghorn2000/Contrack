import { z } from "zod";

// SVG is excluded because it can carry scripts when opened from the bucket.
export const IMAGE_CONTENT_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;

export type ImageContentType = keyof typeof IMAGE_CONTENT_TYPES;

export const IMAGE_KINDS = {
  avatar: { maxBytes: 5 * 1024 * 1024 },
  logo: { maxBytes: 5 * 1024 * 1024 },
  banner: { maxBytes: 10 * 1024 * 1024 },
} as const;

export type ImageKind = keyof typeof IMAGE_KINDS;

export const imageFileSchema = z.object({
  contentType: z.enum(
    Object.keys(IMAGE_CONTENT_TYPES) as [
      ImageContentType,
      ...ImageContentType[],
    ],
    { message: "Choose a JPEG, PNG, WebP, or GIF image." },
  ),
  size: z.number().int().positive(),
});

export function imageFileError(
  kind: ImageKind,
  file: { type: string; size: number },
) {
  if (!(file.type in IMAGE_CONTENT_TYPES))
    return "Choose a JPEG, PNG, WebP, or GIF image.";
  const { maxBytes } = IMAGE_KINDS[kind];
  if (file.size > maxBytes)
    return `Images must be ${maxBytes / 1024 / 1024} MB or smaller.`;
  if (file.size <= 0) return "This image is empty.";
  return null;
}
