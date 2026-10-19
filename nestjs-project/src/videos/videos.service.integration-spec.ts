import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import { ChannelsService } from '../channels/channels.service';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import videosConfig from '../config/videos.config';
import {
  VIDEO_PROCESSING_QUEUE,
  type ProcessVideoJobData,
} from '../queue/queue.constants';
import { VideoQueueProducer } from '../queue/video-queue.producer';
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

// A private prefix keeps the jobs of this suite apart from the Compose video-worker.
const TEST_QUEUE_PREFIX = `test-${randomUUID()}`;
// Mutable on purpose: the completeUpload tests shrink the part size.
const testVideosConfig: ConfigType<typeof videosConfig> = videosConfig();

describe('VideosService (integration, real database, storage and queue)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let videosService: VideosService;
  let storageService: StorageService;
  let channelsService: ChannelsService;
  let queue: Queue<ProcessVideoJobData>;
  let producer: VideoQueueProducer;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [videosConfig, storageConfig, queueConfig],
        }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        VideosModule,
      ],
    })
      .overrideProvider(storageConfig.KEY)
      .useValue(testStorageConfig())
      .overrideProvider(queueConfig.KEY)
      .useValue({ ...queueConfig(), prefix: TEST_QUEUE_PREFIX })
      .overrideProvider(videosConfig.KEY)
      .useValue(testVideosConfig)
      .compile();

    dataSource = module.get(DataSource);
    videosService = module.get(VideosService);
    storageService = module.get(StorageService);
    channelsService = module.get(ChannelsService);
    queue = module.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
    producer = module.get(VideoQueueProducer);
    await storageService.ensureBucket();
  }, 30000);

  afterAll(async () => {
    await queue.obliterate({ force: true });
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

  describe('completeUpload', () => {
    // Two 5 MiB parts and a short last part: the smallest real multipart shape.
    const PART_SIZE = 5 * MIB;
    const FULL_SIZES = [PART_SIZE, PART_SIZE, 1024];
    const SIZE = FULL_SIZES.reduce((sum, size) => sum + size, 0);

    beforeEach(async () => {
      testVideosConfig.uploadPartSizeBytes = PART_SIZE;
      await queue.obliterate({ force: true });
    });

    afterEach(() => {
      testVideosConfig.uploadPartSizeBytes = videosConfig().uploadPartSizeBytes;
    });

    async function initiateDraft(
      userId: string,
    ): Promise<{ id: string; part_count: number }> {
      return videosService.initiateUpload(userId, {
        filename: 'aula.mp4',
        size_bytes: SIZE,
        content_type: 'video/mp4',
      });
    }

    /** Sends parts 1..sizes.length straight to storage with the given sizes. */
    async function sendParts(
      userId: string,
      videoId: string,
      sizes: number[],
    ): Promise<void> {
      const { urls } = await videosService.createPartUrls(userId, videoId, {
        part_numbers: sizes.map((_, index) => index + 1),
      });
      for (const { part_number, url } of urls) {
        const put = await fetch(url, {
          method: 'PUT',
          body: new Uint8Array(sizes[part_number - 1]),
        });
        expect(put.status).toBe(200);
      }
    }

    const rowOf = (id: string): Promise<Video> =>
      dataSource.getRepository(Video).findOneByOrFail({ id });

    const jobsOf = async (id: string): Promise<number> =>
      (await queue.getJobs()).filter((job) => job.id === id).length;

    it('completes into processing with the object stored and one job', async () => {
      const { userId } = await createUserWithChannel();
      const { id } = await initiateDraft(userId);
      await sendParts(userId, id, FULL_SIZES);

      const result = await videosService.completeUpload(userId, id);

      expect(result).toEqual({ id, status: VideoStatus.PROCESSING });
      const row = await rowOf(id);
      expect(row.status).toBe(VideoStatus.PROCESSING);
      expect(row.upload_id).toBeNull();
      await expect(storageService.headObject(row.storage_key)).resolves.toEqual(
        expect.objectContaining({ sizeBytes: SIZE }),
      );
      expect(await jobsOf(id)).toBe(1);
      const job = await queue.getJob(id);
      expect(job!.data).toEqual({ videoId: id });
    });

    it('keeps the draft when a part is missing', async () => {
      const { userId } = await createUserWithChannel();
      const { id } = await initiateDraft(userId);
      await sendParts(userId, id, [PART_SIZE]);

      await expect(
        videosService.completeUpload(userId, id),
      ).rejects.toMatchObject({ errorCode: 'UPLOAD_INCOMPLETE' });

      const row = await rowOf(id);
      expect(row.status).toBe(VideoStatus.DRAFT);
      expect(row.upload_id).not.toBeNull();
      expect(await jobsOf(id)).toBe(0);
    });

    it('keeps the draft, and the upload open, when the parts do not add up', async () => {
      const { userId } = await createUserWithChannel();
      const { id } = await initiateDraft(userId);
      await sendParts(userId, id, [PART_SIZE, PART_SIZE, 2048]);

      await expect(
        videosService.completeUpload(userId, id),
      ).rejects.toMatchObject({ errorCode: 'VIDEO_SIZE_MISMATCH' });

      const row = await rowOf(id);
      expect(row.status).toBe(VideoStatus.DRAFT);
      // Nothing was finalized, so the client can re-send the last part.
      await expect(
        storageService.listAllParts(row.storage_key, row.upload_id!),
      ).resolves.toHaveLength(3);
      expect(await jobsOf(id)).toBe(0);
    });

    it('does not create a second job when called again', async () => {
      const { userId } = await createUserWithChannel();
      const { id } = await initiateDraft(userId);
      await sendParts(userId, id, FULL_SIZES);

      await videosService.completeUpload(userId, id);
      const second = await videosService.completeUpload(userId, id);

      expect(second).toEqual({ id, status: VideoStatus.PROCESSING });
      expect(await jobsOf(id)).toBe(1);
    });

    it('serializes two parallel calls: both succeed and one job exists', async () => {
      const { userId } = await createUserWithChannel();
      const { id } = await initiateDraft(userId);
      await sendParts(userId, id, FULL_SIZES);

      const results = await Promise.all([
        videosService.completeUpload(userId, id),
        videosService.completeUpload(userId, id),
      ]);

      expect(results).toEqual([
        { id, status: VideoStatus.PROCESSING },
        { id, status: VideoStatus.PROCESSING },
      ]);
      expect((await rowOf(id)).status).toBe(VideoStatus.PROCESSING);
      expect(await jobsOf(id)).toBe(1);
    });

    it('recovers when the enqueue failed after the commit', async () => {
      const { userId } = await createUserWithChannel();
      const { id } = await initiateDraft(userId);
      await sendParts(userId, id, FULL_SIZES);
      jest
        .spyOn(producer, 'enqueueProcessing')
        .mockRejectedValueOnce(new Error('redis down'));

      await expect(videosService.completeUpload(userId, id)).rejects.toThrow(
        'redis down',
      );
      expect((await rowOf(id)).status).toBe(VideoStatus.PROCESSING);
      expect(await jobsOf(id)).toBe(0);

      await videosService.completeUpload(userId, id);

      expect(await jobsOf(id)).toBe(1);
    });

    it('recovers an object finalized by an earlier call that failed before the update', async () => {
      const { userId } = await createUserWithChannel();
      const { id } = await initiateDraft(userId);
      await sendParts(userId, id, FULL_SIZES);
      const before = await rowOf(id);
      const parts = await storageService.listAllParts(
        before.storage_key,
        before.upload_id!,
      );
      // What the failed call did: finalize in storage, never reach the database.
      await storageService.completeMultipartUpload(
        before.storage_key,
        before.upload_id!,
        parts.map(({ partNumber, etag }) => ({ partNumber, etag })),
      );
      expect((await rowOf(id)).status).toBe(VideoStatus.DRAFT);

      const result = await videosService.completeUpload(userId, id);

      expect(result).toEqual({ id, status: VideoStatus.PROCESSING });
      const row = await rowOf(id);
      expect(row.status).toBe(VideoStatus.PROCESSING);
      expect(row.upload_id).toBeNull();
      expect(await jobsOf(id)).toBe(1);
    });

    it('rejects a ready or failed video with VIDEO_ALREADY_PROCESSED', async () => {
      const { userId } = await createUserWithChannel();
      const { id } = await initiateDraft(userId);

      for (const status of [VideoStatus.READY, VideoStatus.FAILED]) {
        await dataSource.getRepository(Video).update(id, { status });

        await expect(
          videosService.completeUpload(userId, id),
        ).rejects.toMatchObject({ errorCode: 'VIDEO_ALREADY_PROCESSED' });
      }
      expect(await jobsOf(id)).toBe(0);
    });

    it('hides the video of another user as VIDEO_NOT_FOUND', async () => {
      const owner = await createUserWithChannel();
      const other = await createUserWithChannel();
      const { id } = await initiateDraft(owner.userId);

      await expect(
        videosService.completeUpload(other.userId, id),
      ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });
    });
  });

  describe('getStreamUrl', () => {
    const BODY = Uint8Array.from({ length: 1000 }, (_, i) => (i % 251) + 1);

    async function createVideoWithObject(
      userId: string,
      status: VideoStatus,
    ): Promise<Video> {
      const { id } = await videosService.initiateUpload(userId, dto);
      const video = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ id });
      await storageService.putObject(video.storage_key, BODY, 'video/mp4');
      await dataSource.getRepository(Video).update(id, { status });
      return video;
    }

    it('returns a URL that storage serves with 206 and the exact Content-Range', async () => {
      const { userId } = await createUserWithChannel();
      const video = await createVideoWithObject(userId, VideoStatus.READY);

      const { url, expires_in } = await videosService.getStreamUrl(
        undefined,
        video.id,
      );

      expect(expires_in).toBe(testVideosConfig.presignGetExpiresSeconds);
      const res = await fetch(url, { headers: { Range: 'bytes=0-99' } });
      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe('bytes 0-99/1000');
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(
        BODY.slice(0, 100),
      );
    });

    it('lets the owner stream a processing video', async () => {
      const { userId } = await createUserWithChannel();
      const video = await createVideoWithObject(userId, VideoStatus.PROCESSING);

      const { url } = await videosService.getStreamUrl(userId, video.id);

      const res = await fetch(url, { headers: { Range: 'bytes=0-9' } });
      expect(res.status).toBe(206);
    });

    it('answers VIDEO_FILE_NOT_AVAILABLE to the owner of a draft', async () => {
      const { userId } = await createUserWithChannel();
      const { id } = await videosService.initiateUpload(userId, dto);

      await expect(
        videosService.getStreamUrl(userId, id),
      ).rejects.toMatchObject({ errorCode: 'VIDEO_FILE_NOT_AVAILABLE' });
    });

    it('hides a processing video from another user as VIDEO_NOT_FOUND', async () => {
      const owner = await createUserWithChannel();
      const other = await createUserWithChannel();
      const video = await createVideoWithObject(
        owner.userId,
        VideoStatus.PROCESSING,
      );

      await expect(
        videosService.getStreamUrl(other.userId, video.id),
      ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });
    });
  });

  describe('getVisibleVideo', () => {
    async function initiateDraft(userId: string): Promise<{ id: string }> {
      return videosService.initiateUpload(userId, dto);
    }

    it('lets the owner read a draft, and flags the owner', async () => {
      const { userId } = await createUserWithChannel();
      const { id } = await initiateDraft(userId);

      const { video, isOwner } = await videosService.getVisibleVideo(
        userId,
        id,
      );

      expect(isOwner).toBe(true);
      expect(video).toMatchObject({ id, status: VideoStatus.DRAFT });
    });

    it('hides a draft from another user as VIDEO_NOT_FOUND', async () => {
      const owner = await createUserWithChannel();
      const other = await createUserWithChannel();
      const { id } = await initiateDraft(owner.userId);

      await expect(
        videosService.getVisibleVideo(other.userId, id),
      ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });
    });

    it('hides a non-ready video from an anonymous caller', async () => {
      const { userId } = await createUserWithChannel();
      const { id } = await initiateDraft(userId);

      for (const status of [
        VideoStatus.DRAFT,
        VideoStatus.PROCESSING,
        VideoStatus.FAILED,
      ]) {
        await dataSource.getRepository(Video).update(id, { status });

        await expect(
          videosService.getVisibleVideo(undefined, id),
        ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });
      }
    });

    it('lets anyone read a ready video, owner or not', async () => {
      const owner = await createUserWithChannel();
      const other = await createUserWithChannel();
      const { id } = await initiateDraft(owner.userId);
      await dataSource
        .getRepository(Video)
        .update(id, { status: VideoStatus.READY });

      const asOwner = await videosService.getVisibleVideo(owner.userId, id);
      const asOther = await videosService.getVisibleVideo(other.userId, id);
      const asAnonymous = await videosService.getVisibleVideo(undefined, id);

      expect(asOwner.isOwner).toBe(true);
      expect(asOther.isOwner).toBe(false);
      expect(asAnonymous.isOwner).toBe(false);
      expect(asAnonymous.video.id).toBe(id);
    });

    it('answers VIDEO_NOT_FOUND for an unknown id', async () => {
      await expect(
        videosService.getVisibleVideo(undefined, randomUUID()),
      ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });
    });

    it('treats a user without a channel as a non-owner', async () => {
      const owner = await createUserWithChannel();
      const noChannelUser = await dataSource.getRepository(User).save(
        dataSource.getRepository(User).create({
          email: `nochannel_${randomUUID()}@example.com`,
          password: 'hashed',
        }),
      );
      const { id } = await initiateDraft(owner.userId);

      await expect(
        videosService.getVisibleVideo(noChannelUser.id, id),
      ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });
    });
  });
});
