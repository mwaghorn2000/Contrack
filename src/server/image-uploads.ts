import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  IMAGE_CONTENT_TYPES,
  IMAGE_KINDS,
  imageFileError,
  type ImageKind,
} from "~/lib/image-upload";
import {
  createUploadUrl,
  deleteObject,
  getObjectInfo,
  keyFromPublicUrl,
  publicUrl,
  storageConfigured,
} from "~/server/storage";

// Matches the keys created below; ownership is checked against the folder.
export const imageKeySchema = z
  .string()
  .max(200)
  .regex(/^[a-z]+\/c[a-z0-9]+\/[a-z]+\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/);

export function userImageFolder(userId: string) {
  return `users/${userId}/avatar`;
}

export function companyImageFolder(companyId: string, kind: "logo" | "banner") {
  return `companies/${companyId}/${kind}`;
}

export function companyFolder(companyId: string) {
  return `companies/${companyId}/`;
}

function requireStorage() {
  if (!storageConfigured())
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Image uploads are not set up yet.",
    });
}

export async function createImageUpload(
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
  const key = `${folder}/${randomUUID()}.${IMAGE_CONTENT_TYPES[file.contentType]}`;
  return {
    key,
    uploadUrl: await createUploadUrl(key, file.contentType),
    headers: { "Content-Type": file.contentType },
  };
}

/** Checks that an uploaded object belongs to the folder and is a valid image. */
export async function confirmImageUpload(
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
  const object = await getObjectInfo(key);
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
  return publicUrl(key);
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
