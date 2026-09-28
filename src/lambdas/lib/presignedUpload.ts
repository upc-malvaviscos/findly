import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const PRESIGNED_UPLOAD_EXPIRY_SECONDS = 300;

const endpoint = process.env.AWS_ENDPOINT_URL;
const clientOptions = endpoint
  ? { endpoint, region: 'eu-west-1' }
  : { region: 'eu-west-1' };
const s3 = new S3Client({
  ...clientOptions,
  forcePathStyle: Boolean(endpoint),
});

export type PresignedUploadRequest = {
  bucket: string;
  key: string;
  contentType: 'image/jpeg';
  writeOnce?: boolean;
  expiresInSeconds?: number;
};

export type PresignedUploadResult = {
  uploadUrl: string;
  expiresInSeconds: number;
};

export async function createPresignedUploadUrl(
  request: PresignedUploadRequest,
): Promise<PresignedUploadResult> {
  const expiresInSeconds =
    request.expiresInSeconds ?? PRESIGNED_UPLOAD_EXPIRY_SECONDS;
  if (
    !Number.isInteger(expiresInSeconds) ||
    expiresInSeconds < 1 ||
    expiresInSeconds > PRESIGNED_UPLOAD_EXPIRY_SECONDS
  )
    throw new Error('INVALID_UPLOAD_EXPIRY');
  const command = new PutObjectCommand({
    Bucket: request.bucket,
    Key: request.key,
    ContentType: request.contentType,
    ...(request.writeOnce ? { IfNoneMatch: '*' } : {}),
  });
  const uploadUrl = await getSignedUrl(s3, command, {
    expiresIn: expiresInSeconds,
    // S3 presigning excludes Content-Type unless explicitly made signable.
    signableHeaders: new Set([
      'content-type',
      ...(request.writeOnce ? ['if-none-match'] : []),
    ]),
  });
  return { uploadUrl, expiresInSeconds };
}
