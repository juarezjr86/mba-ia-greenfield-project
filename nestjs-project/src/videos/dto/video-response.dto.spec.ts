import { Video, VideoStatus } from '../entities/video.entity';
import { toVideoResponse } from './video-response.dto';

// The 17 keys of the GET /videos/:id contract (API Contracts, SI-03.15).
const CONTRACT_KEYS = [
  'bitrate',
  'channel_id',
  'container_format',
  'content_type',
  'created_at',
  'duration_seconds',
  'failure_reason',
  'fps',
  'height',
  'id',
  'original_filename',
  'size_bytes',
  'status',
  'title',
  'updated_at',
  'video_codec',
  'width',
].sort();

function makeVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 'a1b2c3d4-0000-4000-8000-000000000001',
    channel_id: 'a1b2c3d4-0000-4000-8000-000000000002',
    title: 'Aula 01',
    original_filename: 'aula.mp4',
    content_type: 'video/mp4',
    size_bytes: 1048576,
    status: VideoStatus.FAILED,
    upload_id: 'secret-upload-id',
    part_size_bytes: 5242880,
    part_count: 1,
    storage_key: 'videos/a1b2c3d4/original.mp4',
    thumbnail_key: 'videos/a1b2c3d4/thumbnail.jpg',
    duration_seconds: 12.5,
    container_format: 'mov,mp4,m4a,3gp,3g2,mj2',
    video_codec: 'h264',
    width: 640,
    height: 360,
    bitrate: 800000,
    fps: 29.97,
    ffprobe_metadata: { format: { filename: 'internal' } },
    failure_reason: 'Invalid data found when processing input',
    created_at: new Date('2026-10-18T10:00:00.000Z'),
    updated_at: new Date('2026-10-18T10:05:00.000Z'),
    ...overrides,
  } as Video;
}

describe('toVideoResponse', () => {
  it('exposes exactly the keys of the contract and nothing else', () => {
    const result = toVideoResponse(makeVideo(), true);

    expect(Object.keys(result).sort()).toEqual(CONTRACT_KEYS);
  });

  it('never leaks internal columns, even for the owner', () => {
    const result = toVideoResponse(makeVideo(), true) as unknown as Record<
      string,
      unknown
    >;

    for (const hidden of [
      'ffprobe_metadata',
      'upload_id',
      'storage_key',
      'thumbnail_key',
      'part_size_bytes',
      'part_count',
    ]) {
      expect(result).not.toHaveProperty(hidden);
    }
  });

  it('shows failure_reason to the owner', () => {
    expect(toVideoResponse(makeVideo(), true).failure_reason).toBe(
      'Invalid data found when processing input',
    );
  });

  it('hides failure_reason from anyone else', () => {
    expect(toVideoResponse(makeVideo(), false).failure_reason).toBeNull();
  });

  it('serializes the dates as ISO 8601 strings', () => {
    const result = toVideoResponse(makeVideo(), false);

    expect(result.created_at).toBe('2026-10-18T10:00:00.000Z');
    expect(result.updated_at).toBe('2026-10-18T10:05:00.000Z');
  });

  it('keeps the metadata of a video that was never probed as null', () => {
    const result = toVideoResponse(
      makeVideo({
        status: VideoStatus.DRAFT,
        duration_seconds: null,
        container_format: null,
        video_codec: null,
        width: null,
        height: null,
        bitrate: null,
        fps: null,
        failure_reason: null,
      }),
      true,
    );

    expect(result).toMatchObject({
      duration_seconds: null,
      container_format: null,
      video_codec: null,
      width: null,
      height: null,
      bitrate: null,
      fps: null,
      failure_reason: null,
    });
  });
});
