import { ApiProperty } from '@nestjs/swagger';
import { Video, VideoStatus } from '../entities/video.entity';

export class VideoResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  channel_id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ enum: VideoStatus, example: VideoStatus.READY })
  status: VideoStatus;

  @ApiProperty()
  original_filename: string;

  @ApiProperty({ example: 'video/mp4' })
  content_type: string;

  @ApiProperty({ type: 'integer', example: 1073741824 })
  size_bytes: number;

  @ApiProperty({ type: 'number', nullable: true, example: 1500.123 })
  duration_seconds: number | null;

  @ApiProperty({ nullable: true, example: 'mov,mp4,m4a,3gp,3g2,mj2' })
  container_format: string | null;

  @ApiProperty({ nullable: true, example: 'h264' })
  video_codec: string | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 1920 })
  width: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 1080 })
  height: number | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 4500000 })
  bitrate: number | null;

  @ApiProperty({ type: 'number', nullable: true, example: 29.97 })
  fps: number | null;

  @ApiProperty({
    nullable: true,
    description:
      'Why processing failed. Present only for the owner of the video; null for anyone else.',
  })
  failure_reason: string | null;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ format: 'date-time' })
  updated_at: string;
}

/**
 * Field-by-field on purpose (no spread): `ffprobe_metadata`, `upload_id`,
 * `part_size_bytes`, `part_count`, `storage_key` and `thumbnail_key` are not
 * part of the contract and must not leak when the entity grows a column.
 */
export function toVideoResponse(
  video: Video,
  isOwner: boolean,
): VideoResponseDto {
  return {
    id: video.id,
    channel_id: video.channel_id,
    title: video.title,
    status: video.status,
    original_filename: video.original_filename,
    content_type: video.content_type,
    size_bytes: video.size_bytes,
    duration_seconds: video.duration_seconds,
    container_format: video.container_format,
    video_codec: video.video_codec,
    width: video.width,
    height: video.height,
    bitrate: video.bitrate,
    fps: video.fps,
    failure_reason: isOwner ? video.failure_reason : null,
    created_at: video.created_at.toISOString(),
    updated_at: video.updated_at.toISOString(),
  };
}
