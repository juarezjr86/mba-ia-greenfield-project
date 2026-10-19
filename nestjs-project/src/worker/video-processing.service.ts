import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { UnrecoverableError } from 'bullmq';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import videosConfig from '../config/videos.config';
import { MediaToolError } from '../media/media.errors';
import { MediaToolsService } from '../media/media-tools.service';
import type { MediaMetadata } from '../media/probe-mapper';
import { StorageService } from '../storage/storage.service';
import { Video, VideoStatus } from '../videos/entities/video.entity';

const THUMBNAIL_CONTENT_TYPE = 'image/jpeg';
const MAX_FAILURE_REASON_CHARS = 1000;

interface ExtractedMedia {
  metadata: MediaMetadata;
  thumbnail: Buffer;
}

export function thumbnailKeyFor(videoId: string): string {
  return `thumbnails/${videoId}/default.jpg`;
}

/**
 * The work of a `process-video` job: metadata, thumbnail and the final status.
 * It lives here and not in the BullMQ processor so it can be tested without a
 * queue. The worker owns its status updates, so it never imports `VideosModule`.
 */
@Injectable()
export class VideoProcessingService {
  private readonly logger = new Logger(VideoProcessingService.name);

  constructor(
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    private readonly storageService: StorageService,
    private readonly mediaTools: MediaToolsService,
    @Inject(videosConfig.KEY)
    private readonly config: ConfigType<typeof videosConfig>,
  ) {}

  /**
   * Idempotent: a `ready` video returns at once; a rerun overwrites the
   * thumbnail and the metadata under the same keys. Errors that no retry can
   * fix are `UnrecoverableError`; `UnsupportedMediaError` and the retryable
   * `MediaToolError` come from the media tools and are handled by the caller.
   */
  async process(videoId: string): Promise<void> {
    const video = await this.videos.findOneBy({ id: videoId });
    if (!video) {
      throw new UnrecoverableError(`Video ${videoId} does not exist`);
    }
    if (video.status === VideoStatus.READY) {
      return;
    }
    if (video.status === VideoStatus.DRAFT) {
      throw new UnrecoverableError(
        `Video ${videoId} is still a draft: its upload was not completed`,
      );
    }

    const object = await this.storageService.headObject(video.storage_key);
    if (!object) {
      throw new UnrecoverableError(
        `The uploaded file of video ${videoId} does not exist in storage`,
      );
    }

    const { metadata, thumbnail } = await this.extract(video.storage_key);

    const thumbnailKey = thumbnailKeyFor(videoId);
    await this.storageService.putObject(
      thumbnailKey,
      thumbnail,
      THUMBNAIL_CONTENT_TYPE,
    );
    await this.videos.update(videoId, {
      duration_seconds: metadata.duration_seconds,
      container_format: metadata.container_format,
      video_codec: metadata.video_codec,
      width: metadata.width,
      height: metadata.height,
      bitrate: metadata.bitrate,
      fps: metadata.fps,
      ffprobe_metadata: metadata.ffprobe_metadata,
      thumbnail_key: thumbnailKey,
      status: VideoStatus.READY,
      failure_reason: null,
      // TypeORM's deep-partial type rejects a value for a jsonb column.
    } as QueryDeepPartialEntity<Video>);
  }

  /**
   * Terminal failure. Conditional on `processing`, so a late event never
   * overwrites a video that already became `ready`.
   */
  async markFailed(videoId: string, reason: string): Promise<void> {
    await this.videos.update(
      { id: videoId, status: VideoStatus.PROCESSING },
      {
        status: VideoStatus.FAILED,
        failure_reason: reason.slice(0, MAX_FAILURE_REASON_CHARS),
      },
    );
  }

  /**
   * Default: the tools read the object through a presigned URL (`Range`, no
   * copy). If that read fails for a reason outside the media (a retryable
   * `MediaToolError`), try once more on a downloaded copy (TD-07 fallback).
   */
  private async extract(storageKey: string): Promise<ExtractedMedia> {
    // The URL has to outlive both tool runs, each limited by the timeout.
    const expiresIn =
      Math.ceil((2 * this.config.mediaToolTimeoutMs) / 1000) + 60;
    const url = await this.storageService.presignGet(storageKey, {
      expiresIn,
      client: 'internal',
    });

    try {
      return await this.runTools(url);
    } catch (err) {
      if (!(err instanceof MediaToolError)) {
        throw err;
      }
      this.logger.warn(
        `Reading ${storageKey} over its URL failed (${err.message}); retrying on a downloaded copy`,
      );
      return this.runToolsOnDownloadedCopy(storageKey);
    }
  }

  private async runToolsOnDownloadedCopy(
    storageKey: string,
  ): Promise<ExtractedMedia> {
    const directory = await mkdtemp(join(tmpdir(), 'video-fallback-'));
    try {
      const localPath = join(directory, 'original');
      await this.storageService.downloadToFile(storageKey, localPath);
      return await this.runTools(localPath);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async runTools(input: string): Promise<ExtractedMedia> {
    const metadata = await this.mediaTools.probe(input);
    const thumbnail = await this.mediaTools.extractThumbnail(
      input,
      metadata.duration_seconds ?? 0,
    );
    return { metadata, thumbnail };
  }
}
