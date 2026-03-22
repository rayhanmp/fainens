import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { promises as fs } from "fs";
import { join, dirname } from "path";

import { env } from "../lib/env";

// Check if R2 is configured with valid values
const isR2Configured = () => {
  // Check that all required values exist and are not placeholder/invalid values
  const hasAccountId = env.R2_ACCOUNT_ID && 
    env.R2_ACCOUNT_ID.length > 0 && 
    !env.R2_ACCOUNT_ID.startsWith('http') && 
    !env.R2_ACCOUNT_ID.startsWith('https');
  const hasAccessKey = env.R2_ACCESS_KEY_ID && env.R2_ACCESS_KEY_ID.length > 0;
  const hasSecretKey = env.R2_SECRET_ACCESS_KEY && env.R2_SECRET_ACCESS_KEY.length > 0;
  return !!(hasAccountId && hasAccessKey && hasSecretKey);
};

// Local storage path for when R2 is not configured
const LOCAL_STORAGE_PATH = join(process.cwd(), "data", "attachments");

// Ensure local storage directory exists
async function ensureLocalStorageDir(): Promise<void> {
  try {
    await fs.mkdir(LOCAL_STORAGE_PATH, { recursive: true });
  } catch {
    // Directory already exists or created
  }
}

// Extract account ID from R2_ACCOUNT_ID (handles both "accountId" and full URL formats)
function getR2AccountId(): string {
  if (!env.R2_ACCOUNT_ID) return '';
  
  // If it's already a full URL, extract the account ID from it
  if (env.R2_ACCOUNT_ID.startsWith('http')) {
    const match = env.R2_ACCOUNT_ID.match(/https?:\/\/([^.]+)\./);
    return match ? match[1] : '';
  }
  
  return env.R2_ACCOUNT_ID;
}

// R2 is S3-compatible - only initialized if R2 is configured
function getR2Client(): S3Client {
  if (!isR2Configured()) {
    throw new Error(
      "R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY environment variables."
    );
  }
  
  const accountId = getR2AccountId();
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

const bucketName = env.R2_BUCKET_NAME;

export async function uploadFile(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<{ key: string; size: number }> {
  // If R2 is not configured, store locally
  if (!isR2Configured()) {
    await ensureLocalStorageDir();
    const filePath = join(LOCAL_STORAGE_PATH, key);
    
    // Ensure subdirectory exists
    const dir = dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    
    await fs.writeFile(filePath, buffer);
    return { key, size: buffer.length };
  }

  // Use R2
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
  // If R2 is not configured, serve local file directly
  if (!isR2Configured()) {
    // For local files, we serve them through a different endpoint
    // Return a local URL that the backend will handle
    return `/api/attachments/local/${encodeURIComponent(key)}`;
  }

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
  // If R2 is not configured, delete local file
  if (!isR2Configured()) {
    try {
      const filePath = join(LOCAL_STORAGE_PATH, key);
      await fs.unlink(filePath);
    } catch {
      // File might not exist, ignore error
    }
    return;
  }

  const r2Client = getR2Client();
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  await r2Client.send(command);
}

export function getPublicUrl(key: string): string | null {
  if (isR2Configured() && env.R2_PUBLIC_URL) {
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

// Get local file path for serving files stored locally
export function getLocalFilePath(key: string): string {
  return join(LOCAL_STORAGE_PATH, key);
}
