import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  IMAGE_CONTENT_TYPES,
  IMAGE_KINDS,
  imageFileError,
  type ImageKind,
} from "~/lib/image-upload";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TYPES,
  attachmentFileError,
  type AttachmentType,
} from "~/lib/attachments";
import type { Prisma } from "../../generated/prisma";
import {
  UPLOAD_CACHE_CONTROL,
  createUploadUrl,
  deleteObject,
  getObjectInfo,
  keyFromPublicUrl,
  publicUrl,
  signedReadUrl,
  storageConfigured,
} from "~/server/storage";

export function userImageFolder(userId: string) {
  return `users/${userId}/avatar`;
}

export function companyImageFolder(companyId: string, kind: "logo" | "banner") {
  return `companies/${companyId}/${kind}`;
}

export function companyFolder(companyId: string) {
  return `companies/${companyId}/`;
}

// Channel files are private: rows store their keys and reads use signed URLs.
export function channelImageFolder(
  channelId: string,
  kind: "icon" | "messages",
) {
  return `channels/${channelId}/${kind}`;
}

export function channelFolder(channelId: string) {
  return `channels/${channelId}/`;
}

// Job photos are private too, so only people who can see the job get a link.
export function jobPhotoFolder(jobId: string) {
  return `jobs/${jobId}/photo`;
}

/** Where photos and files attached on one job tile are stored. */
export function tileFilesFolder(jobId: string, tileId: string) {
  return `jobs/${jobId}/tiles/${tileId}`;
}

export function jobFolder(jobId: string) {
  return `jobs/${jobId}/`;
}

function requireStorage() {
  if (!storageConfigured())
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Image uploads are not set up yet.",
    });
}

export const IMAGE_UPLOADS_PER_HOUR = 30;
// A site can need far more photos than profiles or chat do.
export const JOB_FILE_UPLOADS_PER_HOUR = 300;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Refuses an upload once this user has made too many in the past hour. Job
 * files (under jobs/) and other images have separate limits, so neither uses
 * up the other's.
 */
async function requireUploadAllowance(
  db: Prisma.TransactionClient,
  userId: string,
  folder: string,
) {
  const jobFile = folder.startsWith("jobs/");
  const recent = await db.imageUpload.count({
    where: {
      userId,
      createdAt: { gt: new Date(Date.now() - HOUR_MS) },
      ...(jobFile
        ? { key: { startsWith: "jobs/" } }
        : { NOT: { key: { startsWith: "jobs/" } } }),
    },
  });
  if (recent >= (jobFile ? JOB_FILE_UPLOADS_PER_HOUR : IMAGE_UPLOADS_PER_HOUR))
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: jobFile
        ? "You have uploaded too many files. Please try again later."
        : "You have uploaded too many images. Please try again later.",
    });
}

export async function createImageUpload(
  db: Prisma.TransactionClient,
  userId: string,
  folder: string,
  kind: ImageKind,
  file: { contentType: keyof typeof IMAGE_CONTENT_TYPES; size: number },
) {
  requireStorage();
  const error = imageFileError(kind, {
    type: file.contentType,
    size: file.size,
  });
  if (error) throw new TRPCError({ code: "BAD_REQUEST", message: error });
  await requireUploadAllowance(db, userId, folder);
  const key = `${folder}/${randomUUID()}.${IMAGE_CONTENT_TYPES[file.contentType]}`;
  const uploadUrl = await createUploadUrl(key, file.contentType, file.size);
  await db.imageUpload.create({ data: { key, userId } });
  return {
    key,
    uploadUrl,
    // Storage rejects the upload unless these exact signed headers are sent.
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": UPLOAD_CACHE_CONTROL,
    },
  };
}

/**
 * Claims an upload this user requested in the last hour, then checks that the
 * stored object is a valid image. Each upload can be confirmed only once.
 * Returns the public URL of the image.
 */
export async function confirmImageUpload(
  db: Prisma.TransactionClient,
  userId: string,
  folder: string,
  kind: ImageKind,
  key: string,
) {
  return publicUrl(
    await confirmPrivateImageUpload(db, userId, folder, kind, key),
  );
}

/** Like confirmImageUpload, but returns the key of a private image. */
export async function confirmPrivateImageUpload(
  db: Prisma.TransactionClient,
  userId: string,
  folder: string,
  kind: ImageKind,
  key: string,
) {
  await claimUpload(db, userId, folder, key, {
    types: IMAGE_CONTENT_TYPES,
    maxBytes: IMAGE_KINDS[kind].maxBytes,
    invalid: (object) =>
      imageFileError(kind, {
        type: object.contentType ?? "",
        size: object.size,
      }) ?? "The uploaded image is not valid.",
  });
  return key;
}

/**
 * Claims an upload this user requested into `folder` in the last hour, once
 * only, and checks the stored object is the type its key's extension says
 * and within `maxBytes`. An object that isn't is deleted and refused with
 * `invalid`'s message. Returns its type and size.
 */
async function claimUpload(
  db: Prisma.TransactionClient,
  userId: string,
  folder: string,
  key: string,
  rules: {
    types: Record<string, string>;
    maxBytes: number;
    invalid: (object: { contentType: string | null; size: number }) => string;
  },
) {
  requireStorage();
  if (!key.startsWith(`${folder}/`))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This upload does not belong to you.",
    });
  const claimed = await db.imageUpload.updateMany({
    where: {
      key,
      userId,
      confirmedAt: null,
      createdAt: { gt: new Date(Date.now() - HOUR_MS) },
    },
    data: { confirmedAt: new Date() },
  });
  const object = claimed.count === 1 ? await getObjectInfo(key) : null;
  if (!object)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "The upload could not be found. Please try again.",
    });
  const expectedType = Object.entries(rules.types).find(([, ext]) =>
    key.endsWith(`.${ext}`),
  )?.[0];
  if (
    !expectedType ||
    object.contentType !== expectedType ||
    object.size <= 0 ||
    object.size > rules.maxBytes
  ) {
    await deleteObject(key);
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: rules.invalid(object),
    });
  }
  return { contentType: expectedType, size: object.size };
}

/** Deletes a replaced image when it was stored in this folder. */
export async function deleteReplacedImage(
  folder: string,
  previousUrl: string | null,
  currentUrl: string | null,
) {
  if (!previousUrl || previousUrl === currentUrl) return;
  await deleteReplacedKey(folder, keyFromPublicUrl(previousUrl), null);
}

export async function signedImageUrl(key: string | null) {
  return key && storageConfigured() ? signedReadUrl(key) : null;
}

/** Deletes a replaced private image when it was stored in this folder. */
export async function deleteReplacedKey(
  folder: string,
  previousKey: string | null,
  currentKey: string | null,
) {
  if (!previousKey || previousKey === currentKey) return;
  if (!previousKey.startsWith(`${folder}/`) || !storageConfigured()) return;
  try {
    await deleteObject(previousKey);
  } catch (error) {
    // The new image is already saved; an orphaned file is harmless.
    console.error("Failed to delete replaced image", error);
  }
}

/**
 * Signs an upload of a photo or PDF into a job tile's folder, after the same
 * checks as images. Images are resized in the browser first; PDFs aren't.
 */
export async function createAttachmentUpload(
  db: Prisma.TransactionClient,
  userId: string,
  folder: string,
  file: { contentType: AttachmentType; size: number },
) {
  requireStorage();
  const error = attachmentFileError({
    type: file.contentType,
    size: file.size,
  });
  if (error) throw new TRPCError({ code: "BAD_REQUEST", message: error });
  await requireUploadAllowance(db, userId, folder);
  const key = `${folder}/${randomUUID()}.${ATTACHMENT_TYPES[file.contentType]}`;
  const uploadUrl = await createUploadUrl(key, file.contentType, file.size);
  await db.imageUpload.create({ data: { key, userId } });
  return {
    key,
    uploadUrl,
    // Storage rejects the upload unless these exact signed headers are sent.
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": UPLOAD_CACHE_CONTROL,
    },
  };
}

/**
 * Claims an attachment this user uploaded into `folder` (see claimUpload).
 * Returns its stored type and size.
 */
export function confirmAttachmentUpload(
  db: Prisma.TransactionClient,
  userId: string,
  folder: string,
  key: string,
) {
  return claimUpload(db, userId, folder, key, {
    types: ATTACHMENT_TYPES,
    maxBytes: ATTACHMENT_MAX_BYTES,
    invalid: () => "The uploaded file is not a valid photo or PDF.",
  });
}
