import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import queueConfig from '../config/queue.config';
import {
  VIDEO_PROCESSING_QUEUE,
  type ProcessVideoJobData,
} from '../queue/queue.constants';
import { VideoQueueProducer } from '../queue/video-queue.producer';
import { Video } from '../videos/entities/video.entity';
import { VideoProcessingModule } from './video-processing.module';
import { VideoProcessingService } from './video-processing.service';
import { VideoProcessor } from './video.processor';
import { WorkerModule } from './worker.module';

// A private prefix: a Worker started here never competes with the Compose
// video-worker for jobs, and the Compose worker never sees these.
const TEST_QUEUE_PREFIX = `test-${randomUUID()}`;

async function compile(
  rootModule: typeof WorkerModule | typeof AppModule,
): Promise<TestingModule> {
  const module = await Test.createTestingModule({ imports: [rootModule] })
    .overrideProvider(queueConfig.KEY)
    .useValue({ ...queueConfig(), prefix: TEST_QUEUE_PREFIX })
    .compile();
  // The Worker of a @Processor is created in onModuleInit.
  await module.init();
  return module;
}

describe('WorkerModule (integration, real database and Redis)', () => {
  let module: TestingModule;
  let queue: Queue<ProcessVideoJobData>;

  beforeAll(async () => {
    module = await compile(WorkerModule);
    queue = module.get(getQueueToken(VIDEO_PROCESSING_QUEUE), {
      strict: false,
    });
  }, 30000);

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await module.close();
  });

  it('boots with the real root configuration and registers the consumer', () => {
    expect(module.get(VideoProcessor)).toBeDefined();
    expect(module.get(VideoProcessingService)).toBeDefined();
  });

  it('builds the whole entity graph from its own DataSource', () => {
    const dataSource = module.get(DataSource);

    // Video#channel -> Channel -> User and the token tables must all be known.
    expect(() => dataSource.getMetadata(Video)).not.toThrow();
    expect(
      dataSource.getMetadata(Video).relations.map((r) => r.propertyName),
    ).toContain('channel');
    expect(dataSource.entityMetadatas.map((m) => m.tableName).sort()).toEqual(
      expect.arrayContaining([
        'channels',
        'refresh_tokens',
        'users',
        'verification_tokens',
        'videos',
      ]),
    );
  });

  it('starts exactly one Worker on the video queue', async () => {
    // The Worker connects and names its connection right after init.
    const deadline = Date.now() + 5000;
    let workers = await queue.getWorkers();
    while (workers.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      workers = await queue.getWorkers();
    }

    expect(workers).toHaveLength(1);
  });

  it('declares no controller, so no HTTP surface exists', () => {
    for (const moduleClass of [WorkerModule, VideoProcessingModule]) {
      expect(
        Reflect.getMetadata('controllers', moduleClass) as unknown,
      ).toBeUndefined();
    }
  });
});

describe('AppModule without the worker module (integration, real Redis)', () => {
  let module: TestingModule;
  let queue: Queue<ProcessVideoJobData>;

  beforeAll(async () => {
    module = await compile(AppModule);
    queue = module.get(getQueueToken(VIDEO_PROCESSING_QUEUE), {
      strict: false,
    });
  }, 30000);

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await module.close();
  });

  it('starts no Worker, so the API process does not consume jobs', async () => {
    await expect(queue.getWorkers()).resolves.toEqual([]);
  });

  it('leaves an enqueued job waiting', async () => {
    const videoId = randomUUID();

    await module
      .get(VideoQueueProducer, { strict: false })
      .enqueueProcessing(videoId);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const job = await queue.getJob(videoId);
    await expect(job!.getState()).resolves.toBe('waiting');
    expect(job!.attemptsMade).toBe(0);
  });
});
