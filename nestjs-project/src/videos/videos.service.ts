import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  ChannelNotFoundException,
  UploadSizeExceededException,
} from '../common/exceptions/domain.exception';
import { ChannelsService } from '../channels/channels.service';
import videosConfig from '../config/videos.config';
import { StorageService } from '../storage/storage.service';
import type { InitiateUploadDto } from './dto/initiate-upload.dto';
import type { InitiateUploadResponseDto } from './dto/initiate-upload-response.dto';
import { Video, VideoStatus } from './entities/video.entity';
import { computeUploadPlan } from './upload-plan.util';
import { buildStorageKey, defaultTitle } from './video-naming.util';

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
}
