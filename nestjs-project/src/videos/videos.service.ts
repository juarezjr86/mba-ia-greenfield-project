import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  ChannelNotFoundException,
  InvalidPartNumbersException,
  PartUrlsBatchTooLargeException,
  UploadSizeExceededException,
  VideoNotFoundException,
  VideoNotInDraftException,
} from '../common/exceptions/domain.exception';
import { ChannelsService } from '../channels/channels.service';
import videosConfig from '../config/videos.config';
import { StorageService } from '../storage/storage.service';
import type { InitiateUploadDto } from './dto/initiate-upload.dto';
import type { InitiateUploadResponseDto } from './dto/initiate-upload-response.dto';
import type { PartUrlsDto } from './dto/part-urls.dto';
import type { PartUrlsResponseDto } from './dto/part-urls-response.dto';
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

    const { upload_id, part_size_bytes, part_count } = video;
    if (upload_id === null || part_size_bytes === null || part_count === null) {
      // A draft is saved with its multipart fields in one transaction.
      throw new Error(`Draft video ${videoId} has no multipart upload`);
    }
    return Object.assign(video, { upload_id, part_size_bytes, part_count });
  }
}
