import { prepareImage } from "./image-upload-button";
import { attachmentFileError, type AttachmentType } from "~/lib/attachments";

/**
 * Uploads a photo or PDF straight to storage. Photos are re-encoded first,
 * dropping metadata such as GPS location and scaling down huge ones; PDFs go
 * as they are. `create` asks the server to sign the upload.
 */
export async function uploadAttachment(
  original: File,
  create: (file: { contentType: AttachmentType; size: number }) => Promise<{
    key: string;
    uploadUrl: string;
    headers: Record<string, string>;
  }>,
) {
  const file = original.type.startsWith("image/")
    ? (await prepareImage(original, "attachment")).file
    : original;
  const error = attachmentFileError(file);
  if (error) throw new Error(error);
  const target = await create({
    contentType: file.type as AttachmentType,
    size: file.size,
  });
  const response = await fetch(target.uploadUrl, {
    method: "PUT",
    headers: target.headers,
    body: file,
  });
  if (!response.ok)
    throw new Error(`Could not upload ${original.name}. Please try again.`);
  return { key: target.key, name: original.name };
}
