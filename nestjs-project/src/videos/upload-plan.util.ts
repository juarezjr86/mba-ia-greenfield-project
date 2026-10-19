const MIB = 1024 * 1024;
/** S3 allows at most 10,000 parts per multipart upload. */
export const MAX_UPLOAD_PARTS = 10000;
/** Largest value the `integer` column `part_size_bytes` holds. */
const MAX_PART_SIZE_BYTES = 2147483647;

export interface UploadPlan {
  partSizeBytes: number;
  partCount: number;
}

/**
 * Part size: the configured size, raised when the file would need more than
 * 10,000 parts, rounded up to a whole MiB (and kept inside the integer column).
 */
export function computeUploadPlan(
  sizeBytes: number,
  configuredPartSizeBytes: number,
): UploadPlan {
  const minimumForPartLimit = Math.ceil(sizeBytes / MAX_UPLOAD_PARTS);
  const wanted = Math.max(configuredPartSizeBytes, minimumForPartLimit);
  const partSizeBytes = Math.min(
    Math.ceil(wanted / MIB) * MIB,
    MAX_PART_SIZE_BYTES,
  );

  return { partSizeBytes, partCount: Math.ceil(sizeBytes / partSizeBytes) };
}
