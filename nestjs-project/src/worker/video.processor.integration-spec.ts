import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import videosConfig from '../config/videos.config';
import { MediaToolError } from '../media/media.errors';
import { MediaToolsService } from '../media/media-tools.service';
import {
  VIDEO_PROCESSING_QUEUE,
  type ProcessVideoJobData,
} from '../queue/queue.constants';
import { VideoQueueProducer } from '../queue/video-queue.producer';
import { StorageService } from '../storage/storage.service';
import { createProcessingVideo } from '../test/create-processing-video';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { generateMp4, notAVideo } from '../test/media-fixtures';
import { User } from '../users/entities/user.entity';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import { VideoProcessingModule } from './video-processing.module';
import { VideoProcessor } from './video.processor';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];
const BUCKET = 'streamtube-test-processor';
const ATTEMPTS = 2;
const BACKOFF_MS = 100;
// A private prefix: this suite's Worker never competes with the Compose
// video-worker, and the Compose worker never sees this suite's jobs.
const TEST_QUEUE_PREFIX = `test-${randomUUID()}`;

function testStorageConfig(): ConfigType<typeof storageConfig> {
  return {
    ...storageConfig(),
    bucket: BUCKET,
    publicEndpoint: 'http://storage:9000',
  };
}

describe('VideoProcessor (integration, real Redis, database, storage and tools)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let storage: StorageService;
  let media: MediaToolsService;
  let producer: VideoQueueProducer;
  let queue: Queue<ProcessVideoJobData>;
  let cleanupClient: S3Client;
  let workDir: string;
  let validMp4: Buffer;

  const rowOf = (id: string): Promise<Video> =>
    dataSource.getRepository(Video).findOneByOrFail({ id });

  /** Polls the row: the status is written by the worker after the job event. */
  async function waitForStatus(
    id: string,
    statuses: VideoStatus[],
    timeoutMs = 30000,
  ): Promise<Video> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = await rowOf(id);
      if (statuses.includes(row.status)) return row;
      if (Date.now() > deadline) {
        throw new Error(
          `Video ${id} is still ${row.status} after ${timeoutMs} ms`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  beforeAll(async () => {
    const config = testStorageConfig();
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig, videosConfig, queueConfig],
        }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        VideoProcessingModule,
      ],
    })
      .overrideProvider(storageConfig.KEY)
      .useValue(config)
      .overrideProvider(queueConfig.KEY)
      .useValue({
        ...queueConfig(),
        prefix: TEST_QUEUE_PREFIX,
        videoJobAttempts: ATTEMPTS,
        videoJobBackoffMs: BACKOFF_MS,
      })
      .compile();
    // compile() does not run onModuleInit, which is where the Worker of the
    // @Processor is created.
    await module.init();

    dataSource = module.get(DataSource);
    storage = module.get(StorageService);
    media = module.get(MediaToolsService);
    producer = module.get(VideoQueueProducer);
    queue = module.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
    cleanupClient = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
    });
    await storage.ensureBucket();

    workDir = await mkdtemp(join(tmpdir(), 'processor-spec-'));
    const mp4Path = join(workDir, 'valid.mp4');
    await generateMp4(mp4Path, { durationSeconds: 3 });
    validMp4 = await readFile(mp4Path);
  }, 60000);

  afterAll(async () => {
    const rows = await dataSource.query<
      { storage_key: string; thumbnail_key: string | null }[]
    >('SELECT storage_key, thumbnail_key FROM videos');
    for (const row of rows) {
      for (const Key of [row.storage_key, row.thumbnail_key]) {
        if (Key) {
          await cleanupClient.send(
            new DeleteObjectCommand({ Bucket: BUCKET, Key }),
          );
        }
      }
    }
    cleanupClient.destroy();
    await queue.obliterate({ force: true });
    await rm(workDir, { recursive: true, force: true });
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs a job to ready', async () => {
    const { id } = await createProcessingVideo(dataSource, storage, validMp4);

    await producer.enqueueProcessing(id);

    const row = await waitForStatus(id, [
      VideoStatus.READY,
      VideoStatus.FAILED,
    ]);
    expect(row.status).toBe(VideoStatus.READY);
    expect(row.thumbnail_key).toBe(`thumbnails/${id}/default.jpg`);
    expect(row.width).toBe(1280);
    const job = await queue.getJob(id);
    await expect(job!.isCompleted()).resolves.toBe(true);
    expect(job!.attemptsMade).toBe(1);
  });

  it('retries a retryable error and ends failed after the last attempt', async () => {
    const { id } = await createProcessingVideo(dataSource, storage, validMp4);
    // Fails the URL read and the download fallback alike, on every attempt.
    const probe = jest
      .spyOn(media, 'probe')
      .mockRejectedValue(new MediaToolError('tool unavailable'));

    await producer.enqueueProcessing(id);

    const row = await waitForStatus(id, [
      VideoStatus.READY,
      VideoStatus.FAILED,
    ]);
    expect(row.status).toBe(VideoStatus.FAILED);
    expect(row.failure_reason).toContain('tool unavailable');
    const job = await queue.getJob(id);
    expect(job!.attemptsMade).toBe(ATTEMPTS);
    await expect(job!.isFailed()).resolves.toBe(true);
    // URL read plus fallback, once per attempt.
    expect(probe).toHaveBeenCalledTimes(ATTEMPTS * 2);
  });

  it('ends failed after a single attempt on a corrupt file, with a reason', async () => {
    const { id } = await createProcessingVideo(
      dataSource,
      storage,
      notAVideo(),
    );

    await producer.enqueueProcessing(id);

    const row = await waitForStatus(id, [
      VideoStatus.READY,
      VideoStatus.FAILED,
    ]);
    expect(row.status).toBe(VideoStatus.FAILED);
    expect(row.failure_reason).toContain('Invalid data found');
    expect(row.failure_reason).not.toContain('X-Amz-');
    const job = await queue.getJob(id);
    expect(job!.attemptsMade).toBe(1);
  });

  it('ends failed after a single attempt when the object is missing', async () => {
    const { id } = await createProcessingVideo(dataSource, storage, validMp4, {
      storage_key: `videos/${randomUUID()}/never-uploaded.mp4`,
    });

    await producer.enqueueProcessing(id);

    const row = await waitForStatus(id, [
      VideoStatus.READY,
      VideoStatus.FAILED,
    ]);
    expect(row.status).toBe(VideoStatus.FAILED);
    expect(row.failure_reason).toContain('does not exist in storage');
    const job = await queue.getJob(id);
    expect(job!.attemptsMade).toBe(1);
  });

  it('ends failed when the job stalls past maxStalledCount', async () => {
    const { id } = await createProcessingVideo(dataSource, storage, validMp4);
    const { worker } = module.get(VideoProcessor);
    const redis = new Redis({ host: 'redis', port: 6379 });
    // Only the test Worker may take the job; the module's Worker resumes after
    // the stall, like a restarted process. `pause()` without `true` also drops
    // its blocking read, which would otherwise still take a job.
    await worker.pause();
    let started!: () => void;
    const jobStarted = new Promise<void>((resolve) => (started = resolve));
    // Takes the job and never renews its lock, as a process that died would.
    // maxStalledCount 0: the first stall already exceeds the limit (the check
    // compares `stalledCount > maxStalledCount`).
    const dyingWorker = new Worker<ProcessVideoJobData>(
      VIDEO_PROCESSING_QUEUE,
      () => {
        started();
        return new Promise<void>(() => undefined);
      },
      {
        connection: queue.opts.connection,
        prefix: TEST_QUEUE_PREFIX,
        lockDuration: 300,
        stalledInterval: 200,
        maxStalledCount: 0,
        skipLockRenewal: true,
      },
    );

    try {
      await producer.enqueueProcessing(id);
      await jobStarted;
      // The module's Worker ran a stalled check when it started, and that
      // check blocks every other one for its `stalledInterval` (30 s).
      await redis.del(
        `${TEST_QUEUE_PREFIX}:${VIDEO_PROCESSING_QUEUE}:stalled-check`,
      );
      // The check sends the job back to the queue, marked to fail.
      const deadline = Date.now() + 15000;
      while ((await queue.getJob(id))!.deferredFailure === undefined) {
        if (Date.now() > deadline) throw new Error('The job never stalled');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } finally {
      await dyingWorker.close(true);
      redis.disconnect();
    }
    await worker.resume();

    const row = await waitForStatus(id, [
      VideoStatus.READY,
      VideoStatus.FAILED,
    ]);
    expect(row.status).toBe(VideoStatus.FAILED);
    expect(row.failure_reason).toContain('stalled more than allowable limit');
    const job = await queue.getJob(id);
    await expect(job!.isFailed()).resolves.toBe(true);
  }, 30000);
});
