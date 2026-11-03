import { z } from "zod";
import { IMAGE_CONTENT_TYPES } from "./image-upload";

// Photos and PDFs people attach on job tiles, by content type and extension.
export const ATTACHMENT_TYPES = {
  ...IMAGE_CONTENT_TYPES,
  "application/pdf": "pdf",
} as const;

export type AttachmentType = keyof typeof ATTACHMENT_TYPES;

export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

export const attachmentFileSchema = z.object({
  contentType: z.enum(
    Object.keys(ATTACHMENT_TYPES) as [AttachmentType, ...AttachmentType[]],
    { message: "Choose a photo (JPEG, PNG, WebP or GIF) or a PDF." },
  ),
  size: z.number().int().positive().max(ATTACHMENT_MAX_BYTES),
});

// Matches the keys the server makes: jobs/<job>/tiles/<tile>/<uuid>.<ext>.
export const attachmentKeySchema = z
  .string()
  .max(200)
  .regex(
    /^jobs\/c[a-z0-9]+\/tiles\/c[a-z0-9]+\/[0-9a-f-]{36}\.(jpg|png|webp|gif|pdf)$/,
  );

/** Why a file can't be attached, or null when it can. */
export function attachmentFileError(file: { type: string; size: number }) {
  if (!(file.type in ATTACHMENT_TYPES))
    return "Choose a photo (JPEG, PNG, WebP or GIF) or a PDF.";
  if (file.size > ATTACHMENT_MAX_BYTES)
    return "Files must be 20 MB or smaller.";
  if (file.size <= 0) return "This file is empty.";
  return null;
}

/**
 * Checks a file chosen in the browser. Photos other than GIFs are shrunk
 * before upload, so only GIFs and PDFs, sent as they are, have their size
 * checked here.
 */
export function attachmentSelectionError(file: { type: string; size: number }) {
  const shrunk = file.type.startsWith("image/") && file.type !== "image/gif";
  return attachmentFileError(shrunk ? { type: file.type, size: 1 } : file);
}

/**
 * Splits files picked in the browser into those to add, at most `room` of
 * them, and a message naming each refused file and why (`tooMany` if some
 * didn't fit).
 */
export function pickAttachments<
  F extends { name: string; type: string; size: number },
>(picked: F[], room: number, tooMany: string) {
  const refused: string[] = [];
  const fitting: F[] = [];
  for (const file of picked) {
    const reason = attachmentSelectionError(file);
    if (reason) refused.push(`${file.name}: ${reason}`);
    else fitting.push(file);
  }
  if (fitting.length > room) refused.push(tooMany);
  return {
    accepted: fitting.slice(0, Math.max(0, room)),
    error: refused.join(" "),
  };
}
