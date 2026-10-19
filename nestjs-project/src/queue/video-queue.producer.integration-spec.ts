import { randomUUID } from 'node:crypto';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import queueConfig from '../config/queue.config';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_QUEUE,
  type ProcessVideoJobData,
} from './queue.constants';
import { QueueModule } from './queue.module';
import { VideoQueueProducer } from './video-queue.producer';

// A private prefix keeps this suite's jobs apart from the Compose video-worker.
const TEST_PREFIX = `test-${randomUUID()}`;

function testConfig(): ConfigType<typeof queueConfig> {
  return { ...queueConfig(), prefix: TEST_PREFIX };
}

describe('VideoQueueProducer (integration, real Redis)', () => {
  let module: TestingModule;
  let producer: VideoQueueProducer;
  let queue: Queue<ProcessVideoJobData>;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] }),
        QueueModule,
      ],
    })
      .overrideProvider(queueConfig.KEY)
      .useValue(testConfig())
      .compile();

    producer = module.get(VideoQueueProducer);
    queue = module.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await module.close();
  });

  it('enqueues a process-video job whose id is the video id', async () => {
    const videoId = randomUUID();

    await producer.enqueueProcessing(videoId);

    const job = await queue.getJob(videoId);
    expect(job).toBeDefined();
    expect(job!.id).toBe(videoId);
    expect(job!.name).toBe(PROCESS_VIDEO_JOB);
    expect(job!.data).toEqual({ videoId });
  });

  it('stores the retry policy: 3 attempts with exponential backoff of 30000 ms', async () => {
    const videoId = randomUUID();

    await producer.enqueueProcessing(videoId);

    const job = await queue.getJob(videoId);
    expect(job!.opts.attempts).toBe(3);
    expect(job!.opts.backoff).toEqual({ type: 'exponential', delay: 30000 });
  });

  it('keeps a single job when the same video is enqueued twice', async () => {
    const videoId = randomUUID();

    await producer.enqueueProcessing(videoId);
    await producer.enqueueProcessing(videoId);

    const jobs = await queue.getJobs();
    expect(jobs.filter((job) => job.id === videoId)).toHaveLength(1);
  });

  it('is invisible to a queue created with another prefix', async () => {
    const videoId = randomUUID();
    await producer.enqueueProcessing(videoId);
    const { host, port } = testConfig();
    const otherQueue = new Queue(VIDEO_PROCESSING_QUEUE, {
      connection: { host, port },
      prefix: `${TEST_PREFIX}-other`,
    });

    try {
      await expect(otherQueue.getJob(videoId)).resolves.toBeUndefined();
    } finally {
      await otherQueue.close();
    }
  });

  it('has no worker attached while only the API context is running', async () => {
    await expect(queue.getWorkers()).resolves.toEqual([]);
  });
});
