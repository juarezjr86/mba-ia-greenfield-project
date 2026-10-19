import { computeUploadPlan, MAX_UPLOAD_PARTS } from './upload-plan.util';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

describe('computeUploadPlan', () => {
  it('uses the configured part size when the file fits in 10,000 parts', () => {
    const plan = computeUploadPlan(12 * MIB, 64 * MIB);

    expect(plan).toEqual({ partSizeBytes: 64 * MIB, partCount: 1 });
  });

  it('never goes below the S3 minimum of 5 MiB when configured at the minimum', () => {
    const plan = computeUploadPlan(20 * MIB, 5 * MIB);

    expect(plan.partSizeBytes).toBe(5 * MIB);
    expect(plan.partCount).toBe(4);
  });

  it('needs at most 10,000 parts for 10 GiB with the default 64 MiB', () => {
    const plan = computeUploadPlan(10 * GIB, 64 * MIB);

    expect(plan.partSizeBytes).toBe(64 * MIB);
    expect(plan.partCount).toBe(160);
  });

  it('raises the part size when the configured one would need more than 10,000 parts', () => {
    const plan = computeUploadPlan(10 * GIB, 5 * MIB);

    expect(plan.partCount).toBeLessThanOrEqual(MAX_UPLOAD_PARTS);
    expect(plan.partSizeBytes).toBeGreaterThanOrEqual(5 * MIB);
    expect(plan.partSizeBytes % MIB).toBe(0);
  });

  it('rounds the part size up to a whole MiB', () => {
    const plan = computeUploadPlan(10 * GIB, 5_500_000);

    expect(plan.partSizeBytes % MIB).toBe(0);
    expect(plan.partSizeBytes).toBeGreaterThanOrEqual(5_500_000);
  });

  it('rounds the part count up for a partial last part', () => {
    const plan = computeUploadPlan(130 * MIB, 64 * MIB);

    expect(plan.partCount).toBe(3);
  });

  it('keeps the part size inside the integer column', () => {
    const plan = computeUploadPlan(10 * GIB, 2147483647);

    expect(plan.partSizeBytes).toBeLessThanOrEqual(2147483647);
    expect(plan.partCount).toBe(Math.ceil((10 * GIB) / plan.partSizeBytes));
  });
});
