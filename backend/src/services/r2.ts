import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "../lib/env";

// R2 is S3-compatible - only initialized if R2 is configured
function getR2Client(): S3Client {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error(
      "R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY environment variables."
    );
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
}

const bucketName = env.R2_BUCKET_NAME;

export async function uploadFile(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<{ key: string; size: number }> {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  const r2Client = getR2Client();
  await r2Client.send(command);

  return {
    key,
    size: buffer.length,
  };
}

export async function generatePresignedDownloadUrl(
  key: string,
  expiresInSeconds: number = 3600,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  const r2Client = getR2Client();
  const url = await getSignedUrl(r2Client, command, {
    expiresIn: expiresInSeconds,
  });

  return url;
}

export async function deleteFile(key: string): Promise<void> {
  const r2Client = getR2Client();
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  await r2Client.send(command);
}

export function getPublicUrl(key: string): string | null {
  if (env.R2_PUBLIC_URL) {
    return `${env.R2_PUBLIC_URL}/${key}`;
  }
  return null;
}

export function generateAttachmentKey(
  transactionId: number,
  filename: string,
): string {
  const timestamp = Date.now();
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
  return `attachments/${transactionId}/${timestamp}_${sanitizedFilename}`;
}
