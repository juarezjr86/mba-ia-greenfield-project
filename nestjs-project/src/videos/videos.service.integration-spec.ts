import { randomUUID } from 'node:crypto';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import { ChannelsService } from '../channels/channels.service';
import storageConfig from '../config/storage.config';
import videosConfig from '../config/videos.config';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video, VideoStatus } from './entities/video.entity';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];
const MIB = 1024 * 1024;

// A bucket that does not exist on a fresh clone: ensureBucket() must create it.
function testStorageConfig(): ConfigType<typeof storageConfig> {
  return {
    ...storageConfig(),
    bucket: 'streamtube-test-videos',
    publicEndpoint: 'http://storage:9000',
  };
}

describe('VideosService (integration, real database and storage)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let videosService: VideosService;
  let storageService: StorageService;
  let channelsService: ChannelsService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [videosConfig, storageConfig],
        }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        VideosModule,
      ],
    })
      .overrideProvider(storageConfig.KEY)
      .useValue(testStorageConfig())
      .compile();

    dataSource = module.get(DataSource);
    videosService = module.get(VideosService);
    storageService = module.get(StorageService);
    channelsService = module.get(ChannelsService);
    await storageService.ensureBucket();
  }, 30000);

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function createUserWithChannel(): Promise<{
    userId: string;
    channel: Channel;
  }> {
    const user = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        email: `uploader_${randomUUID()}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelsService.createChannel(
      user.id,
      `uploader_${randomUUID().slice(0, 8)}@example.com`,
    );
    return { userId: user.id, channel };
  }

  const dto = {
    filename: 'aula.mp4',
    size_bytes: 12 * MIB,
    content_type: 'video/mp4',
  };

  it('persists the draft with the caller channel, the upload id and the plan', async () => {
    const { userId, channel } = await createUserWithChannel();

    const result = await videosService.initiateUpload(userId, dto);

    const row = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: result.id });
    expect(row).toMatchObject({
      channel_id: channel.id,
      status: VideoStatus.DRAFT,
      title: 'aula',
      original_filename: 'aula.mp4',
      content_type: 'video/mp4',
      size_bytes: 12 * MIB,
      storage_key: `videos/${result.id}/original.mp4`,
      part_size_bytes: result.part_size_bytes,
      part_count: result.part_count,
    });
    expect(row.upload_id).toEqual(expect.any(String));
    expect(row.upload_id).not.toBe('');
  });

  it('creates a real multipart upload in storage that can be listed', async () => {
    const { userId } = await createUserWithChannel();

    const result = await videosService.initiateUpload(userId, dto);

    const row = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: result.id });
    await expect(
      storageService.listAllParts(row.storage_key, row.upload_id!),
    ).resolves.toEqual([]);
  });

  it('leaves no video row when the storage call fails', async () => {
    const { userId } = await createUserWithChannel();
    jest
      .spyOn(storageService, 'createMultipartUpload')
      .mockRejectedValueOnce(new Error('storage down'));

    await expect(videosService.initiateUpload(userId, dto)).rejects.toThrow(
      'storage down',
    );

    await expect(dataSource.getRepository(Video).count()).resolves.toBe(0);
  });

  it('stores nothing and calls no storage when the size is above the maximum', async () => {
    const { userId } = await createUserWithChannel();
    const createSpy = jest.spyOn(storageService, 'createMultipartUpload');

    await expect(
      videosService.initiateUpload(userId, {
        ...dto,
        size_bytes: 10 * 1024 * MIB + 1,
      }),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_SIZE_EXCEEDED' });

    expect(createSpy).not.toHaveBeenCalled();
    await expect(dataSource.getRepository(Video).count()).resolves.toBe(0);
  });

  it('throws CHANNEL_NOT_FOUND for a user without a channel', async () => {
    const user = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        email: `nochannel_${randomUUID()}@example.com`,
        password: 'hashed',
      }),
    );

    await expect(
      videosService.initiateUpload(user.id, dto),
    ).rejects.toMatchObject({ errorCode: 'CHANNEL_NOT_FOUND' });
  });

  describe('createPartUrls', () => {
    it('returns a URL that accepts a direct 5 MiB PUT and answers with an ETag', async () => {
      const { userId } = await createUserWithChannel();
      const { id } = await videosService.initiateUpload(userId, dto);

      const { urls, expires_in } = await videosService.createPartUrls(
        userId,
        id,
        { part_numbers: [1] },
      );

      expect(expires_in).toBe(3600);
      const response = await fetch(urls[0].url, {
        method: 'PUT',
        body: new Uint8Array(5 * MIB),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('etag')).toEqual(expect.any(String));
    });

    it('hides the video of another user as VIDEO_NOT_FOUND', async () => {
      const owner = await createUserWithChannel();
      const other = await createUserWithChannel();
      const { id } = await videosService.initiateUpload(owner.userId, dto);

      await expect(
        videosService.createPartUrls(other.userId, id, { part_numbers: [1] }),
      ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });
    });

    it('rejects a video that left draft with VIDEO_NOT_IN_DRAFT', async () => {
      const { userId } = await createUserWithChannel();
      const { id } = await videosService.initiateUpload(userId, dto);
      await dataSource
        .getRepository(Video)
        .update(id, { status: VideoStatus.PROCESSING });

      await expect(
        videosService.createPartUrls(userId, id, { part_numbers: [1] }),
      ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_IN_DRAFT' });
    });
  });

  describe('listUploadedParts', () => {
    it('lists two parts sent straight to storage, in order, with sizes and ETags', async () => {
      const { userId } = await createUserWithChannel();
      const { id } = await videosService.initiateUpload(userId, {
        ...dto,
        size_bytes: 70 * MIB,
      });
      const { urls } = await videosService.createPartUrls(userId, id, {
        part_numbers: [2, 1],
      });
      const sizes: Record<number, number> = { 1: 64 * MIB, 2: 6 * MIB };
      const etags: Record<number, string | null> = {};
      for (const { part_number, url } of urls) {
        const put = await fetch(url, {
          method: 'PUT',
          body: new Uint8Array(sizes[part_number]),
        });
        expect(put.status).toBe(200);
        etags[part_number] = put.headers.get('etag');
      }

      const result = await videosService.listUploadedParts(userId, id);

      expect(result.part_count).toBe(2);
      expect(result.parts).toEqual([
        { part_number: 1, size_bytes: sizes[1], etag: etags[1] },
        { part_number: 2, size_bytes: sizes[2], etag: etags[2] },
      ]);
    });

    it('returns an empty list for a fresh draft', async () => {
      const { userId } = await createUserWithChannel();
      const { id } = await videosService.initiateUpload(userId, dto);

      const result = await videosService.listUploadedParts(userId, id);

      expect(result.parts).toEqual([]);
    });

    it('hides the video of another user as VIDEO_NOT_FOUND', async () => {
      const owner = await createUserWithChannel();
      const other = await createUserWithChannel();
      const { id } = await videosService.initiateUpload(owner.userId, dto);

      await expect(
        videosService.listUploadedParts(other.userId, id),
      ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });
    });
  });
});
