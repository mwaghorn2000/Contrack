import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  IMAGE_CONTENT_TYPES,
  IMAGE_KINDS,
  imageFileError,
  type ImageKind,
} from "~/lib/image-upload";
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

function requireStorage() {
  if (!storageConfigured())
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Image uploads are not set up yet.",
    });
}

export const IMAGE_UPLOADS_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;

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
  const recent = await db.imageUpload.count({
    where: { userId, createdAt: { gt: new Date(Date.now() - HOUR_MS) } },
  });
  if (recent >= IMAGE_UPLOADS_PER_HOUR)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "You have uploaded too many images. Please try again later.",
    });
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
  const expectedType = Object.entries(IMAGE_CONTENT_TYPES).find(([, ext]) =>
    key.endsWith(`.${ext}`),
  )?.[0];
  if (
    object.contentType !== expectedType ||
    object.size <= 0 ||
    object.size > IMAGE_KINDS[kind].maxBytes
  ) {
    await deleteObject(key);
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        imageFileError(kind, {
          type: object.contentType ?? "",
          size: object.size,
        }) ?? "The uploaded image is not valid.",
    });
  }
  return key;
}

/** Deletes a replaced image when it was stored in this folder. */
export async function deleteReplacedImage(
  folder: string,
  previousUrl: string | null,
  currentUrl: string | null,
) {
  if (!previousUrl || previousUrl === currentUrl) return;
  const key = keyFromPublicUrl(previousUrl);
  if (!key?.startsWith(`${folder}/`)) return;
  try {
    await deleteObject(key);
  } catch (error) {
    // The new image is already saved; an orphaned file is harmless.
    console.error("Failed to delete replaced image", error);
  }
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
    console.error("Failed to delete replaced image", error);
  }
}
