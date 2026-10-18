import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'node:crypto';
import { config } from '../../config/index.js';
import { AppError } from '../../shared/errors.js';
import { log } from '../../shared/context.js';

let s3ClientInstance: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3ClientInstance) {
    const { region, accessKeyId, secretAccessKey } = config.aws;
    if (!accessKeyId || !secretAccessKey) {
      throw new AppError(
        'CONFIG_ERROR',
        'AWS credentials missing. Please set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_S3_BUCKET_NAME in your .env file.',
        500,
        false
      );
    }
    s3ClientInstance = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }
  return s3ClientInstance;
}

export interface UploadOptions {
  key?: string;
  contentType: string;
  metadata?: Record<string, string>;
  tenantId?: string;
  docId?: string;
}

/**
 * Uploads a buffer to S3 with metadata, timeout guards, and per-call details at DEBUG.
 * Never logs presigned URLs or credentials.
 */
export async function uploadBufferToS3(
  buffer: Buffer,
  filename: string,
  options: UploadOptions
): Promise<{ s3Url: string; key: string }> {
  const startHr = process.hrtime.bigint();
  const { bucketName, region } = config.aws;
  if (!bucketName) {
    throw new AppError('CONFIG_ERROR', 'AWS_S3_BUCKET_NAME is not configured in .env', 500, false);
  }

  const s3 = getS3Client();

  // Tenant partitioned path structure
  const key =
    options.key ||
    (options.tenantId && options.docId
      ? `orgs/${options.tenantId}/docs/${options.docId}/${Date.now()}-${filename}`
      : `uploads/${Date.now()}-${filename}`);

  try {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: buffer,
      ContentType: options.contentType,
      Metadata: options.metadata,
    });

    await s3.send(command, { abortSignal: AbortSignal.timeout(30000) });

    const durationMs = Math.round(Number(process.hrtime.bigint() - startHr) / 10_000) / 100;

    log().debug(
      {
        key,
        sizeBytes: buffer.length,
        durationMs,
      },
      'S3 object upload completed'
    );

    const s3Url = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
    return { s3Url, key };
  } catch (err: unknown) {
    const durationMs = Math.round(Number(process.hrtime.bigint() - startHr) / 10_000) / 100;
    const isExpected = err instanceof AppError && err.expected;
    if (isExpected) {
      log().warn({ key, sizeBytes: buffer.length, durationMs, err }, 'Failed to upload object to S3');
    } else {
      log().error({ key, sizeBytes: buffer.length, durationMs, err }, 'Unexpected error uploading object to S3');
    }
    throw new AppError('STORAGE_ERROR', `Failed to upload object to S3: ${(err as Error).message}`, 500, false);
  }
}

/**
 * Creates a presigned download URL with a specific time-to-live.
 * Logs key and duration at DEBUG, but NEVER logs the presigned URL.
 */
export async function createPresignedDownloadUrl(
  key: string,
  expiresInSeconds = 3600
): Promise<string> {
  const startHr = process.hrtime.bigint();
  const { bucketName } = config.aws;
  const s3 = getS3Client();

  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const signedUrl = await getSignedUrl(s3, command, {
      expiresIn: expiresInSeconds,
    });

    const durationMs = Math.round(Number(process.hrtime.bigint() - startHr) / 10_000) / 100;
    log().debug(
      {
        key,
        expiresInSeconds,
        durationMs,
      },
      'Created S3 presigned download URL'
    );

    return signedUrl;
  } catch (err: unknown) {
    log().error({ key, err }, 'Unexpected error generating presigned download URL');
    throw new AppError('STORAGE_ERROR', 'Failed to generate presigned download URL', 500, false);
  }
}

/**
 * Generates a presigned upload URL for direct browser/client-to-S3 uploads.
 * Logs key and duration at DEBUG, but NEVER logs the presigned upload URL.
 */
export async function createPresignedUploadUrl(
  filename: string,
  contentType: string,
  expiresInSeconds = 900,
  tenantId = 'default',
  docId = crypto.randomUUID()
): Promise<{ uploadUrl: string; key: string }> {
  const startHr = process.hrtime.bigint();
  const { bucketName } = config.aws;
  const s3 = getS3Client();

  const key = `orgs/${tenantId}/docs/${docId}/${Date.now()}-${filename}`;

  try {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3, command, {
      expiresIn: expiresInSeconds,
    });

    const durationMs = Math.round(Number(process.hrtime.bigint() - startHr) / 10_000) / 100;
    log().debug(
      {
        key,
        expiresInSeconds,
        durationMs,
      },
      'Created S3 presigned upload URL'
    );

    return { uploadUrl, key };
  } catch (err: unknown) {
    log().error({ key, err }, 'Unexpected error generating presigned upload URL');
    throw new AppError('STORAGE_ERROR', 'Failed to generate presigned upload URL', 500, false);
  }
}
