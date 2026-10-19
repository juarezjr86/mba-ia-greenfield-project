import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { DataSource, type EntityManager } from 'typeorm';
import {
  ChannelNotFoundException,
  FileNotAvailableException,
  InvalidPartNumbersException,
  PartUrlsBatchTooLargeException,
  ThumbnailNotAvailableException,
  UploadIncompleteException,
  UploadSizeExceededException,
  VideoAlreadyProcessedException,
  VideoNotFoundException,
  VideoNotInDraftException,
  VideoSizeMismatchException,
} from '../common/exceptions/domain.exception';
import { ChannelsService } from '../channels/channels.service';
import videosConfig from '../config/videos.config';
import { VideoQueueProducer } from '../queue/video-queue.producer';
import {
  isNoSuchUpload,
  StorageService,
  type StoredPart,
} from '../storage/storage.service';
import type { CompleteUploadResponseDto } from './dto/complete-upload-response.dto';
import type { InitiateUploadDto } from './dto/initiate-upload.dto';
import type { InitiateUploadResponseDto } from './dto/initiate-upload-response.dto';
import type { PartUrlsDto } from './dto/part-urls.dto';
import type { PartUrlsResponseDto } from './dto/part-urls-response.dto';
import type { DownloadUrlResponseDto } from './dto/download-url-response.dto';
import type { PresignedUrlResponseDto } from './dto/presigned-url-response.dto';
import type { UploadedPartsResponseDto } from './dto/uploaded-parts-response.dto';
import { Video, VideoStatus } from './entities/video.entity';
import { computeUploadPlan } from './upload-plan.util';
import { buildStorageKey, defaultTitle } from './video-naming.util';

/** A draft video whose multipart upload fields are known to be set. */
export type OwnedDraft = Video & {
  upload_id: string;
  part_size_bytes: number;
  part_count: number;
};

@Injectable()
export class VideosService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly channelsService: ChannelsService,
    private readonly storageService: StorageService,
    private readonly videoQueueProducer: VideoQueueProducer,
    @Inject(videosConfig.KEY)
    private readonly config: ConfigType<typeof videosConfig>,
  ) {}

  /**
   * Creates the draft video and its multipart upload. Everything is written
   * through the transaction manager, so a storage failure leaves no draft behind.
   */
  async initiateUpload(
    userId: string,
    dto: InitiateUploadDto,
  ): Promise<InitiateUploadResponseDto> {
    if (dto.size_bytes > this.config.uploadMaxSizeBytes) {
      throw new UploadSizeExceededException(this.config.uploadMaxSizeBytes);
    }

    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new ChannelNotFoundException();
    }

    const { partSizeBytes, partCount } = computeUploadPlan(
      dto.size_bytes,
      this.config.uploadPartSizeBytes,
    );
    const id = randomUUID();
    const title = dto.title ?? defaultTitle(dto.filename);
    const storageKey = buildStorageKey(id, dto.filename);

    await this.dataSource.transaction(async (manager) => {
      await manager.save(
        manager.create(Video, {
          id,
          channel_id: channel.id,
          title,
          original_filename: dto.filename,
          content_type: dto.content_type,
          size_bytes: dto.size_bytes,
          status: VideoStatus.DRAFT,
          storage_key: storageKey,
        }),
      );

      const uploadId = await this.storageService.createMultipartUpload(
        storageKey,
        dto.content_type,
      );

      await manager.update(Video, id, {
        upload_id: uploadId,
        part_size_bytes: partSizeBytes,
        part_count: partCount,
      });
    });

    return {
      id,
      title,
      status: VideoStatus.DRAFT,
      size_bytes: dto.size_bytes,
      part_size_bytes: partSizeBytes,
      part_count: partCount,
    };
  }

  /**
   * Presigns the requested parts. Checks run in this order: batch size (no I/O),
   * ownership and draft status, then the part numbers against `part_count`.
   */
  async createPartUrls(
    userId: string,
    videoId: string,
    dto: PartUrlsDto,
  ): Promise<PartUrlsResponseDto> {
    if (dto.part_numbers.length > this.config.partUrlsMaxBatch) {
      throw new PartUrlsBatchTooLargeException(this.config.partUrlsMaxBatch);
    }

    const video = await this.getOwnedDraft(userId, videoId);
    if (dto.part_numbers.some((partNumber) => partNumber > video.part_count)) {
      throw new InvalidPartNumbersException(video.part_count);
    }

    const expiresIn = this.config.presignPartExpiresSeconds;
    const urls = await Promise.all(
      dto.part_numbers.map(async (partNumber) => ({
        part_number: partNumber,
        url: await this.storageService.presignUploadPart(
          video.storage_key,
          video.upload_id,
          partNumber,
          expiresIn,
        ),
      })),
    );

    return { urls, expires_in: expiresIn };
  }

  /** Parts storage already holds, so an interrupted client can resume. */
  async listUploadedParts(
    userId: string,
    videoId: string,
  ): Promise<UploadedPartsResponseDto> {
    const video = await this.getOwnedDraft(userId, videoId);
    const parts = await this.storageService.listAllParts(
      video.storage_key,
      video.upload_id,
    );

    return {
      part_size_bytes: video.part_size_bytes,
      part_count: video.part_count,
      parts: parts.map((part) => ({
        part_number: part.partNumber,
        size_bytes: part.sizeBytes,
        etag: part.etag,
      })),
    };
  }

  /**
   * Video of the caller's channel that is still a draft. A user without a
   * channel, another user's video and an unknown id are all `VIDEO_NOT_FOUND`.
   */
  async getOwnedDraft(userId: string, videoId: string): Promise<OwnedDraft> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new VideoNotFoundException();
    }

    const video = await this.dataSource
      .getRepository(Video)
      .findOne({ where: { id: videoId, channel_id: channel.id } });
    if (!video) {
      throw new VideoNotFoundException();
    }
    if (video.status !== VideoStatus.DRAFT) {
      throw new VideoNotInDraftException();
    }

    return asOwnedDraft(video);
  }

  /**
   * Video the caller may see: the owner reads any status, everyone else
   * (including an anonymous caller, `userId` undefined) only `ready`. A hidden
   * video is `VIDEO_NOT_FOUND`, so a draft is not revealed. Ownership is the
   * caller's channel matching the video's channel, looked up through
   * `ChannelsService` like in `getOwnedDraft`. Returns the entity (the stream,
   * download and thumbnail routes need its keys); the route maps it to a DTO.
   */
  async getVisibleVideo(
    userId: string | undefined,
    videoId: string,
  ): Promise<{ video: Video; isOwner: boolean }> {
    const video = await this.dataSource
      .getRepository(Video)
      .findOne({ where: { id: videoId } });
    if (!video) {
      throw new VideoNotFoundException();
    }

    let isOwner = false;
    if (userId) {
      const channel = await this.channelsService.findByUserId(userId);
      isOwner = channel?.id === video.channel_id;
    }
    if (!isOwner && video.status !== VideoStatus.READY) {
      throw new VideoNotFoundException();
    }

    return { video, isOwner };
  }

  /**
   * Short-lived presigned GET URL of the original file, for the player. Access
   * is decided first by `getVisibleVideo` (a hidden video is 404), so the 409
   * for a `draft` (no stored object yet) is only ever seen by its owner.
   */
  async getStreamUrl(
    userId: string | undefined,
    videoId: string,
  ): Promise<PresignedUrlResponseDto> {
    const video = await this.getVideoWithFile(userId, videoId);

    const expiresIn = this.config.presignGetExpiresSeconds;
    const url = await this.storageService.presignGet(video.storage_key, {
      client: 'public',
      expiresIn,
    });
    return { url, expires_in: expiresIn };
  }

  /**
   * Same access rule as `getStreamUrl`; the content-disposition is signed into
   * the URL, so the browser saves the file under `original_filename`.
   */
  async getDownloadUrl(
    userId: string | undefined,
    videoId: string,
  ): Promise<DownloadUrlResponseDto> {
    const video = await this.getVideoWithFile(userId, videoId);

    const expiresIn = this.config.presignGetExpiresSeconds;
    const url = await this.storageService.presignGet(video.storage_key, {
      client: 'public',
      expiresIn,
      downloadFilename: video.original_filename,
    });
    return {
      url,
      expires_in: expiresIn,
      filename: video.original_filename,
    };
  }

  /**
   * Presigned GET URL of the thumbnail the worker stored. Same visibility rule
   * as the video (`getVisibleVideo`); a visible video without `thumbnail_key`
   * (not processed yet, or `failed`) is 409.
   */
  async getThumbnailUrl(
    userId: string | undefined,
    videoId: string,
  ): Promise<PresignedUrlResponseDto> {
    const { video } = await this.getVisibleVideo(userId, videoId);
    if (!video.thumbnail_key) {
      throw new ThumbnailNotAvailableException();
    }

    const expiresIn = this.config.presignGetExpiresSeconds;
    const url = await this.storageService.presignGet(video.thumbnail_key, {
      client: 'public',
      expiresIn,
    });
    return { url, expires_in: expiresIn };
  }

  /** Visible video that already has a stored object: a `draft` has none (owner only, 409). */
  private async getVideoWithFile(
    userId: string | undefined,
    videoId: string,
  ): Promise<Video> {
    const { video } = await this.getVisibleVideo(userId, videoId);
    if (video.status === VideoStatus.DRAFT) {
      throw new FileNotAvailableException();
    }
    return video;
  }

  /**
   * Finalizes the multipart upload, moves the video to `processing` and
   * enqueues its job. Idempotent: a video already `processing` is only
   * enqueued again (the fixed job id keeps a single job). The row is locked
   * for the whole transaction, so parallel calls serialize and the second one
   * finds `processing`. The enqueue happens after the commit; if it fails the
   * client retries and the `processing` branch enqueues.
   */
  async completeUpload(
    userId: string,
    videoId: string,
  ): Promise<CompleteUploadResponseDto> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new VideoNotFoundException();
    }

    await this.dataSource.transaction(async (manager) => {
      const video = await manager.findOne(Video, {
        where: { id: videoId, channel_id: channel.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!video) {
        throw new VideoNotFoundException();
      }
      if (video.status === VideoStatus.PROCESSING) {
        return;
      }
      if (video.status !== VideoStatus.DRAFT) {
        throw new VideoAlreadyProcessedException();
      }

      await this.finalizeUpload(manager, asOwnedDraft(video));
    });

    await this.videoQueueProducer.enqueueProcessing(videoId);
    return { id: videoId, status: VideoStatus.PROCESSING };
  }

  /**
   * Checks the stored parts, completes the multipart upload and marks the
   * video `processing`. A throw rolls the row back to `draft`; storage may
   * already hold the finalized object, which the recovery branch handles on
   * the next call.
   */
  private async finalizeUpload(
    manager: EntityManager,
    video: OwnedDraft,
  ): Promise<void> {
    let parts: StoredPart[];
    try {
      parts = await this.storageService.listAllParts(
        video.storage_key,
        video.upload_id,
      );
    } catch (err) {
      if (!isNoSuchUpload(err)) {
        throw err;
      }
      // An earlier call completed the upload in storage but did not reach the
      // database update: the object is the proof.
      await this.assertObjectHasDeclaredSize(video);
      await this.markProcessing(manager, video.id);
      return;
    }

    if (parts.length < video.part_count) {
      throw new UploadIncompleteException(parts.length, video.part_count);
    }
    const storedBytes = parts.reduce((sum, part) => sum + part.sizeBytes, 0);
    if (storedBytes !== video.size_bytes) {
      throw new VideoSizeMismatchException(video.size_bytes, storedBytes);
    }

    await this.storageService.completeMultipartUpload(
      video.storage_key,
      video.upload_id,
      parts.map(({ partNumber, etag }) => ({ partNumber, etag })),
    );
    await this.assertObjectHasDeclaredSize(video);
    await this.markProcessing(manager, video.id);
  }

  private async assertObjectHasDeclaredSize(video: OwnedDraft): Promise<void> {
    const object = await this.storageService.headObject(video.storage_key);
    if (!object) {
      throw new UploadIncompleteException(0, video.part_count);
    }
    if (object.sizeBytes !== video.size_bytes) {
      throw new VideoSizeMismatchException(video.size_bytes, object.sizeBytes);
    }
  }

  private async markProcessing(
    manager: EntityManager,
    videoId: string,
  ): Promise<void> {
    await manager.update(Video, videoId, {
      status: VideoStatus.PROCESSING,
      upload_id: null,
    });
  }
}

function asOwnedDraft(video: Video): OwnedDraft {
  const { upload_id, part_size_bytes, part_count } = video;
  if (upload_id === null || part_size_bytes === null || part_count === null) {
    // A draft is saved with its multipart fields in one transaction.
    throw new Error(`Draft video ${video.id} has no multipart upload`);
  }
  return Object.assign(video, { upload_id, part_size_bytes, part_count });
}
