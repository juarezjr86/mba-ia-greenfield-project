import type { ConfigType } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import type { Channel } from '../channels/entities/channel.entity';
import type { ChannelsService } from '../channels/channels.service';
import {
  ChannelNotFoundException,
  UploadSizeExceededException,
} from '../common/exceptions/domain.exception';
import type videosConfig from '../config/videos.config';
import type { StorageService } from '../storage/storage.service';
import { Video, VideoStatus } from './entities/video.entity';
import { VideosService } from './videos.service';

const MIB = 1024 * 1024;

const config: ConfigType<typeof videosConfig> = {
  uploadPartSizeBytes: 64 * MIB,
  uploadMaxSizeBytes: 10 * 1024 * MIB,
  partUrlsMaxBatch: 100,
  presignPartExpiresSeconds: 3600,
  presignGetExpiresSeconds: 900,
  throttleLimit: 120,
  throttleTtlMs: 60000,
  mediaToolTimeoutMs: 600000,
};

interface MockManager {
  create: jest.Mock;
  save: jest.Mock;
  update: jest.Mock;
}

describe('VideosService.initiateUpload', () => {
  let manager: MockManager;
  let dataSource: { transaction: jest.Mock };
  let channelsService: { findByUserId: jest.Mock };
  let storageService: { createMultipartUpload: jest.Mock };
  let service: VideosService;

  beforeEach(() => {
    manager = {
      create: jest.fn((_entity: unknown, data: object) => data),
      save: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    };
    dataSource = {
      transaction: jest.fn((cb: (m: MockManager) => Promise<unknown>) =>
        cb(manager),
      ),
    };
    channelsService = {
      findByUserId: jest.fn().mockResolvedValue({ id: 'channel-1' } as Channel),
    };
    storageService = {
      createMultipartUpload: jest.fn().mockResolvedValue('upload-1'),
    };
    service = new VideosService(
      dataSource as unknown as DataSource,
      channelsService as unknown as ChannelsService,
      storageService as unknown as StorageService,
      config,
    );
  });

  const dto = {
    filename: 'Aula 01.mp4',
    size_bytes: 12 * MIB,
    content_type: 'video/mp4',
  };

  it('defaults the title to the file name without its extension', async () => {
    const result = await service.initiateUpload('user-1', dto);

    expect(result.title).toBe('Aula 01');
    expect(manager.create).toHaveBeenCalledWith(
      Video,
      expect.objectContaining({ title: 'Aula 01' }),
    );
  });

  it('keeps the title sent by the client', async () => {
    const result = await service.initiateUpload('user-1', {
      ...dto,
      title: 'Minha aula',
    });

    expect(result.title).toBe('Minha aula');
  });

  it('creates a draft for the caller channel and records the upload plan', async () => {
    const result = await service.initiateUpload('user-1', dto);

    expect(channelsService.findByUserId).toHaveBeenCalledWith('user-1');
    expect(manager.create).toHaveBeenCalledWith(
      Video,
      expect.objectContaining({
        id: result.id,
        channel_id: 'channel-1',
        status: VideoStatus.DRAFT,
        original_filename: 'Aula 01.mp4',
        content_type: 'video/mp4',
        size_bytes: 12 * MIB,
        storage_key: `videos/${result.id}/original.mp4`,
      }),
    );
    expect(storageService.createMultipartUpload).toHaveBeenCalledWith(
      `videos/${result.id}/original.mp4`,
      'video/mp4',
    );
    expect(manager.update).toHaveBeenCalledWith(Video, result.id, {
      upload_id: 'upload-1',
      part_size_bytes: 64 * MIB,
      part_count: 1,
    });
  });

  it('returns only the public fields', async () => {
    const result = await service.initiateUpload('user-1', dto);

    expect(Object.keys(result).sort()).toEqual([
      'id',
      'part_count',
      'part_size_bytes',
      'size_bytes',
      'status',
      'title',
    ]);
    expect(result.status).toBe(VideoStatus.DRAFT);
  });

  it('rejects a size above the configured maximum before touching anything', async () => {
    await expect(
      service.initiateUpload('user-1', {
        ...dto,
        size_bytes: config.uploadMaxSizeBytes + 1,
      }),
    ).rejects.toBeInstanceOf(UploadSizeExceededException);

    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(storageService.createMultipartUpload).not.toHaveBeenCalled();
  });

  it('accepts a size equal to the configured maximum', async () => {
    const result = await service.initiateUpload('user-1', {
      ...dto,
      size_bytes: config.uploadMaxSizeBytes,
    });

    expect(result.part_count).toBeLessThanOrEqual(10000);
  });

  it('throws ChannelNotFoundException when the user has no channel', async () => {
    channelsService.findByUserId.mockResolvedValue(null);

    await expect(service.initiateUpload('user-1', dto)).rejects.toBeInstanceOf(
      ChannelNotFoundException,
    );

    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('propagates a storage failure and never reaches the upload update', async () => {
    storageService.createMultipartUpload.mockRejectedValue(
      new Error('storage down'),
    );

    await expect(service.initiateUpload('user-1', dto)).rejects.toThrow(
      'storage down',
    );

    expect(manager.update).not.toHaveBeenCalled();
  });
});
