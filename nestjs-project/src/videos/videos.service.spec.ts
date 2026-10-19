import { NoSuchUpload } from '@aws-sdk/client-s3';
import type { ConfigType } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import type { Channel } from '../channels/entities/channel.entity';
import type { ChannelsService } from '../channels/channels.service';
import {
  ChannelNotFoundException,
  InvalidPartNumbersException,
  PartUrlsBatchTooLargeException,
  UploadIncompleteException,
  UploadSizeExceededException,
  VideoAlreadyProcessedException,
  VideoNotFoundException,
  VideoNotInDraftException,
  VideoSizeMismatchException,
} from '../common/exceptions/domain.exception';
import type videosConfig from '../config/videos.config';
import type { VideoQueueProducer } from '../queue/video-queue.producer';
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
      { enqueueProcessing: jest.fn() } as unknown as VideoQueueProducer,
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

describe('VideosService.createPartUrls', () => {
  let dataSource: { getRepository: jest.Mock };
  let repository: { findOne: jest.Mock };
  let channelsService: { findByUserId: jest.Mock };
  let storageService: { presignUploadPart: jest.Mock };
  let service: VideosService;

  const draft = (overrides: Partial<Video> = {}): Video =>
    ({
      id: 'video-1',
      channel_id: 'channel-1',
      status: VideoStatus.DRAFT,
      storage_key: 'videos/video-1/original.mp4',
      upload_id: 'upload-1',
      part_size_bytes: 64 * MIB,
      part_count: 3,
      ...overrides,
    }) as Video;

  beforeEach(() => {
    repository = { findOne: jest.fn().mockResolvedValue(draft()) };
    dataSource = { getRepository: jest.fn().mockReturnValue(repository) };
    channelsService = {
      findByUserId: jest.fn().mockResolvedValue({ id: 'channel-1' } as Channel),
    };
    storageService = {
      presignUploadPart: jest.fn(
        (_key: string, _upload: string, part: number) =>
          Promise.resolve(`https://storage/part-${part}`),
      ),
    };
    service = new VideosService(
      dataSource as unknown as DataSource,
      channelsService as unknown as ChannelsService,
      storageService as unknown as StorageService,
      { enqueueProcessing: jest.fn() } as unknown as VideoQueueProducer,
      config,
    );
  });

  it('presigns each requested part in the order requested', async () => {
    const result = await service.createPartUrls('user-1', 'video-1', {
      part_numbers: [3, 1],
    });

    expect(result).toEqual({
      urls: [
        { part_number: 3, url: 'https://storage/part-3' },
        { part_number: 1, url: 'https://storage/part-1' },
      ],
      expires_in: 3600,
    });
    expect(storageService.presignUploadPart).toHaveBeenCalledWith(
      'videos/video-1/original.mp4',
      'upload-1',
      3,
      3600,
    );
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { id: 'video-1', channel_id: 'channel-1' },
    });
  });

  it('accepts the last part number and a batch of exactly the maximum', async () => {
    repository.findOne.mockResolvedValue(draft({ part_count: 100 }));

    const result = await service.createPartUrls('user-1', 'video-1', {
      part_numbers: Array.from({ length: 100 }, (_, i) => i + 1),
    });

    expect(result.urls).toHaveLength(100);
  });

  it('throws VideoNotFoundException when the video is not in the caller channel', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(
      service.createPartUrls('user-1', 'video-1', { part_numbers: [1] }),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
    expect(storageService.presignUploadPart).not.toHaveBeenCalled();
  });

  it('throws VideoNotFoundException, not CHANNEL_NOT_FOUND, for a user without a channel', async () => {
    channelsService.findByUserId.mockResolvedValue(null);

    await expect(
      service.createPartUrls('user-1', 'video-1', { part_numbers: [1] }),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
    expect(repository.findOne).not.toHaveBeenCalled();
  });

  it('throws VideoNotInDraftException when the upload was completed', async () => {
    repository.findOne.mockResolvedValue(
      draft({ status: VideoStatus.PROCESSING }),
    );

    await expect(
      service.createPartUrls('user-1', 'video-1', { part_numbers: [1] }),
    ).rejects.toBeInstanceOf(VideoNotInDraftException);
    expect(storageService.presignUploadPart).not.toHaveBeenCalled();
  });

  it('throws InvalidPartNumbersException for a part number above part_count', async () => {
    await expect(
      service.createPartUrls('user-1', 'video-1', { part_numbers: [1, 4] }),
    ).rejects.toBeInstanceOf(InvalidPartNumbersException);
    expect(storageService.presignUploadPart).not.toHaveBeenCalled();
  });

  it('checks the batch size first, with no database or storage call', async () => {
    await expect(
      service.createPartUrls('user-1', 'video-1', {
        part_numbers: Array.from({ length: 101 }, (_, i) => i + 1),
      }),
    ).rejects.toBeInstanceOf(PartUrlsBatchTooLargeException);

    expect(channelsService.findByUserId).not.toHaveBeenCalled();
    expect(repository.findOne).not.toHaveBeenCalled();
    expect(storageService.presignUploadPart).not.toHaveBeenCalled();
  });
});

describe('VideosService.listUploadedParts', () => {
  let repository: { findOne: jest.Mock };
  let channelsService: { findByUserId: jest.Mock };
  let storageService: { listAllParts: jest.Mock };
  let service: VideosService;

  const draft = (overrides: Partial<Video> = {}): Video =>
    ({
      id: 'video-1',
      channel_id: 'channel-1',
      status: VideoStatus.DRAFT,
      storage_key: 'videos/video-1/original.mp4',
      upload_id: 'upload-1',
      part_size_bytes: 64 * MIB,
      part_count: 3,
      ...overrides,
    }) as Video;

  beforeEach(() => {
    repository = { findOne: jest.fn().mockResolvedValue(draft()) };
    channelsService = {
      findByUserId: jest.fn().mockResolvedValue({ id: 'channel-1' } as Channel),
    };
    storageService = {
      listAllParts: jest.fn().mockResolvedValue([
        { partNumber: 1, sizeBytes: 64 * MIB, etag: '"a"' },
        { partNumber: 2, sizeBytes: 5 * MIB, etag: '"b"' },
      ]),
    };
    service = new VideosService(
      {
        getRepository: jest.fn().mockReturnValue(repository),
      } as unknown as DataSource,
      channelsService as unknown as ChannelsService,
      storageService as unknown as StorageService,
      { enqueueProcessing: jest.fn() } as unknown as VideoQueueProducer,
      config,
    );
  });

  it('lists the stored parts with the upload plan after the ownership check', async () => {
    const result = await service.listUploadedParts('user-1', 'video-1');

    expect(storageService.listAllParts).toHaveBeenCalledWith(
      'videos/video-1/original.mp4',
      'upload-1',
    );
    expect(result).toEqual({
      part_size_bytes: 64 * MIB,
      part_count: 3,
      parts: [
        { part_number: 1, size_bytes: 64 * MIB, etag: '"a"' },
        { part_number: 2, size_bytes: 5 * MIB, etag: '"b"' },
      ],
    });
  });

  it('returns an empty list when no part was sent', async () => {
    storageService.listAllParts.mockResolvedValue([]);

    const result = await service.listUploadedParts('user-1', 'video-1');

    expect(result.parts).toEqual([]);
  });

  it('throws VideoNotFoundException and skips storage when the video is not the caller one', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(
      service.listUploadedParts('user-1', 'video-1'),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
    expect(storageService.listAllParts).not.toHaveBeenCalled();
  });

  it('throws VideoNotInDraftException and skips storage when the upload was completed', async () => {
    repository.findOne.mockResolvedValue(
      draft({ status: VideoStatus.PROCESSING }),
    );

    await expect(
      service.listUploadedParts('user-1', 'video-1'),
    ).rejects.toBeInstanceOf(VideoNotInDraftException);
    expect(storageService.listAllParts).not.toHaveBeenCalled();
  });
});

describe('VideosService.completeUpload', () => {
  let manager: { findOne: jest.Mock; update: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let channelsService: { findByUserId: jest.Mock };
  let storageService: {
    listAllParts: jest.Mock;
    completeMultipartUpload: jest.Mock;
    headObject: jest.Mock;
  };
  let producer: { enqueueProcessing: jest.Mock };
  let service: VideosService;

  const SIZE = 10 * MIB + 1024;
  const draft = (overrides: Partial<Video> = {}): Video =>
    ({
      id: 'video-1',
      channel_id: 'channel-1',
      status: VideoStatus.DRAFT,
      size_bytes: SIZE,
      storage_key: 'videos/video-1/original.mp4',
      upload_id: 'upload-1',
      part_size_bytes: 5 * MIB,
      part_count: 3,
      ...overrides,
    }) as Video;
  const allParts = [
    { partNumber: 1, sizeBytes: 5 * MIB, etag: '"a"' },
    { partNumber: 2, sizeBytes: 5 * MIB, etag: '"b"' },
    { partNumber: 3, sizeBytes: 1024, etag: '"c"' },
  ];

  beforeEach(() => {
    manager = {
      findOne: jest.fn().mockResolvedValue(draft()),
      update: jest.fn().mockResolvedValue(undefined),
    };
    dataSource = {
      transaction: jest.fn((cb: (m: typeof manager) => Promise<unknown>) =>
        cb(manager),
      ),
    };
    channelsService = {
      findByUserId: jest.fn().mockResolvedValue({ id: 'channel-1' } as Channel),
    };
    storageService = {
      listAllParts: jest.fn().mockResolvedValue(allParts),
      completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
      headObject: jest
        .fn()
        .mockResolvedValue({ sizeBytes: SIZE, contentType: 'video/mp4' }),
    };
    producer = { enqueueProcessing: jest.fn().mockResolvedValue(undefined) };
    service = new VideosService(
      dataSource as unknown as DataSource,
      channelsService as unknown as ChannelsService,
      storageService as unknown as StorageService,
      producer as unknown as VideoQueueProducer,
      config,
    );
  });

  it('completes a draft: finalizes storage, marks processing and enqueues once', async () => {
    const result = await service.completeUpload('user-1', 'video-1');

    expect(result).toEqual({ id: 'video-1', status: VideoStatus.PROCESSING });
    expect(manager.findOne).toHaveBeenCalledWith(Video, {
      where: { id: 'video-1', channel_id: 'channel-1' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(storageService.completeMultipartUpload).toHaveBeenCalledWith(
      'videos/video-1/original.mp4',
      'upload-1',
      [
        { partNumber: 1, etag: '"a"' },
        { partNumber: 2, etag: '"b"' },
        { partNumber: 3, etag: '"c"' },
      ],
    );
    expect(manager.update).toHaveBeenCalledWith(Video, 'video-1', {
      status: VideoStatus.PROCESSING,
      upload_id: null,
    });
    expect(producer.enqueueProcessing).toHaveBeenCalledTimes(1);
    expect(producer.enqueueProcessing).toHaveBeenCalledWith('video-1');
  });

  it('enqueues after the transaction ends, never inside it', async () => {
    let enqueuedInsideTransaction = false;
    dataSource.transaction.mockImplementation(
      async (cb: (m: typeof manager) => Promise<unknown>) => {
        await cb(manager);
        enqueuedInsideTransaction =
          producer.enqueueProcessing.mock.calls.length > 0;
      },
    );

    await service.completeUpload('user-1', 'video-1');

    expect(enqueuedInsideTransaction).toBe(false);
    expect(producer.enqueueProcessing).toHaveBeenCalledTimes(1);
  });

  it('only enqueues again for a video that is already processing', async () => {
    manager.findOne.mockResolvedValue(
      draft({ status: VideoStatus.PROCESSING, upload_id: null }),
    );

    const result = await service.completeUpload('user-1', 'video-1');

    expect(result.status).toBe(VideoStatus.PROCESSING);
    expect(storageService.listAllParts).not.toHaveBeenCalled();
    expect(storageService.completeMultipartUpload).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
    expect(producer.enqueueProcessing).toHaveBeenCalledWith('video-1');
  });

  it.each([VideoStatus.READY, VideoStatus.FAILED])(
    'throws VideoAlreadyProcessedException for a %s video',
    async (status) => {
      manager.findOne.mockResolvedValue(draft({ status }));

      await expect(
        service.completeUpload('user-1', 'video-1'),
      ).rejects.toBeInstanceOf(VideoAlreadyProcessedException);
      expect(producer.enqueueProcessing).not.toHaveBeenCalled();
    },
  );

  it('throws VideoNotFoundException when the video is not in the caller channel', async () => {
    manager.findOne.mockResolvedValue(null);

    await expect(
      service.completeUpload('user-1', 'video-1'),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
    expect(producer.enqueueProcessing).not.toHaveBeenCalled();
  });

  it('throws VideoNotFoundException for a user without a channel, before any transaction', async () => {
    channelsService.findByUserId.mockResolvedValue(null);

    await expect(
      service.completeUpload('user-1', 'video-1'),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('throws UploadIncompleteException when fewer parts than part_count are stored', async () => {
    storageService.listAllParts.mockResolvedValue(allParts.slice(0, 2));

    await expect(
      service.completeUpload('user-1', 'video-1'),
    ).rejects.toBeInstanceOf(UploadIncompleteException);
    expect(storageService.completeMultipartUpload).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
    expect(producer.enqueueProcessing).not.toHaveBeenCalled();
  });

  it('throws VideoSizeMismatchException before finalizing when the parts do not add up', async () => {
    storageService.listAllParts.mockResolvedValue([
      allParts[0],
      allParts[1],
      { partNumber: 3, sizeBytes: 2048, etag: '"c"' },
    ]);

    await expect(
      service.completeUpload('user-1', 'video-1'),
    ).rejects.toBeInstanceOf(VideoSizeMismatchException);
    expect(storageService.completeMultipartUpload).not.toHaveBeenCalled();
    expect(producer.enqueueProcessing).not.toHaveBeenCalled();
  });

  it('throws VideoSizeMismatchException when the finalized object has another size', async () => {
    storageService.headObject.mockResolvedValue({
      sizeBytes: SIZE - 1,
      contentType: 'video/mp4',
    });

    await expect(
      service.completeUpload('user-1', 'video-1'),
    ).rejects.toBeInstanceOf(VideoSizeMismatchException);
    expect(manager.update).not.toHaveBeenCalled();
    expect(producer.enqueueProcessing).not.toHaveBeenCalled();
  });

  it('propagates an unexpected storage failure from ListParts', async () => {
    storageService.listAllParts.mockRejectedValue(new Error('storage down'));

    await expect(service.completeUpload('user-1', 'video-1')).rejects.toThrow(
      'storage down',
    );
    expect(storageService.headObject).not.toHaveBeenCalled();
    expect(producer.enqueueProcessing).not.toHaveBeenCalled();
  });

  describe('recovery when an earlier call already finalized the object', () => {
    const noSuchUpload = (): NoSuchUpload =>
      new NoSuchUpload({ message: 'gone', $metadata: {} });

    beforeEach(() => {
      storageService.listAllParts.mockRejectedValue(noSuchUpload());
    });

    it('finishes the update and enqueues when the object has the declared size', async () => {
      const result = await service.completeUpload('user-1', 'video-1');

      expect(result.status).toBe(VideoStatus.PROCESSING);
      expect(storageService.completeMultipartUpload).not.toHaveBeenCalled();
      expect(manager.update).toHaveBeenCalledWith(Video, 'video-1', {
        status: VideoStatus.PROCESSING,
        upload_id: null,
      });
      expect(producer.enqueueProcessing).toHaveBeenCalledWith('video-1');
    });

    it('throws UploadIncompleteException when there is no object either', async () => {
      storageService.headObject.mockResolvedValue(null);

      await expect(
        service.completeUpload('user-1', 'video-1'),
      ).rejects.toBeInstanceOf(UploadIncompleteException);
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('throws VideoSizeMismatchException when the object has another size', async () => {
      storageService.headObject.mockResolvedValue({
        sizeBytes: 1,
        contentType: 'video/mp4',
      });

      await expect(
        service.completeUpload('user-1', 'video-1'),
      ).rejects.toBeInstanceOf(VideoSizeMismatchException);
      expect(manager.update).not.toHaveBeenCalled();
    });
  });
});
