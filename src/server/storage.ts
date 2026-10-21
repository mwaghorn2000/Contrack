import "server-only";

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "~/env";

const UPLOAD_URL_TTL_SECONDS = 5 * 60;
// Each upload has a unique key, so it can be cached indefinitely.
export const UPLOAD_CACHE_CONTROL = "public, max-age=31536000, immutable";

let client: S3Client | undefined;

function config() {
  const {
    S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY,
    S3_BUCKET,
    S3_PUBLIC_URL,
    S3_REGION,
    S3_ENDPOINT,
  } = env;
  if (
    !S3_ACCESS_KEY_ID ||
    !S3_SECRET_ACCESS_KEY ||
    !S3_BUCKET ||
    !S3_PUBLIC_URL
  )
    return null;
  client ??= new S3Client({
    region: S3_REGION ?? "auto",
    endpoint: S3_ENDPOINT,
    // Neon and other S3-compatible providers require path-style addressing.
    forcePathStyle: Boolean(S3_ENDPOINT),
    // A presigned upload has no body to checksum when the URL is created.
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
    },
  });
  return {
    client,
    bucket: S3_BUCKET,
    publicUrl: S3_PUBLIC_URL.replace(/\/+$/, ""),
  };
}

function requireConfig() {
  const storage = config();
  if (!storage) throw new Error("Image storage is not configured.");
  return storage;
}

export function storageConfigured() {
  return config() !== null;
}

export function publicUrl(key: string) {
  return `${requireConfig().publicUrl}/${key}`;
}

/** Returns the object key for a URL in this bucket, or null for other URLs. */
export function keyFromPublicUrl(url: string) {
  const storage = config();
  if (!storage) return null;
  const prefix = `${storage.publicUrl}/`;
  return url.startsWith(prefix) ? url.slice(prefix.length) : null;
}

/**
 * Signs a PUT for exactly this type and size: storage rejects any upload whose
 * Content-Type, Content-Length or Cache-Control differs.
 */
export async function createUploadUrl(
  key: string,
  contentType: string,
  size: number,
) {
  const { client, bucket } = requireConfig();
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: size,
      CacheControl: UPLOAD_CACHE_CONTROL,
    }),
    {
      expiresIn: UPLOAD_URL_TTL_SECONDS,
      signableHeaders: new Set([
        "content-type",
        "content-length",
        "cache-control",
      ]),
    },
  );
}

export async function getObjectInfo(key: string) {
  const { client, bucket } = requireConfig();
  try {
    const object = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    return {
      size: object.ContentLength ?? 0,
      contentType: object.ContentType ?? null,
    };
  } catch (error) {
    if (error instanceof NotFound) return null;
    throw error;
  }
}

export async function deleteObject(key: string) {
  const { client, bucket } = requireConfig();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function deletePrefix(prefix: string) {
  const { client, bucket } = requireConfig();
  let continuationToken: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    const objects = (page.Contents ?? []).flatMap(({ Key }) =>
      Key ? [{ Key }] : [],
    );
    if (objects.length > 0)
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objects, Quiet: true },
        }),
      );
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);
}
