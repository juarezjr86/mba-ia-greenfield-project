import { registerAs } from '@nestjs/config';

export default registerAs('videos', () => ({
  uploadPartSizeBytes: parseInt(
    process.env.UPLOAD_PART_SIZE_BYTES || '67108864',
    10,
  ),
  uploadMaxSizeBytes: parseInt(
    process.env.UPLOAD_MAX_SIZE_BYTES || '10737418240',
    10,
  ),
  partUrlsMaxBatch: parseInt(process.env.PART_URLS_MAX_BATCH || '100', 10),
  presignPartExpiresSeconds: parseInt(
    process.env.PRESIGN_PART_EXPIRES_SECONDS || '3600',
    10,
  ),
  presignGetExpiresSeconds: parseInt(
    process.env.PRESIGN_GET_EXPIRES_SECONDS || '900',
    10,
  ),
  throttleLimit: parseInt(process.env.VIDEOS_THROTTLE_LIMIT || '120', 10),
  throttleTtlMs: parseInt(process.env.VIDEOS_THROTTLE_TTL_MS || '60000', 10),
  mediaToolTimeoutMs: parseInt(
    process.env.MEDIA_TOOL_TIMEOUT_MS || '600000',
    10,
  ),
}));
