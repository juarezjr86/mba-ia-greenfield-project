import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import queueConfig from '../config/queue.config';
import { VIDEO_PROCESSING_QUEUE } from './queue.constants';
import { QueueModule } from './queue.module';
import { VideoQueueProducer } from './video-queue.producer';

describe('QueueModule', () => {
  it('compiles and exposes the producer and the video-processing queue', async () => {
    const module = await Test.createTestingModule({ imports: [QueueModule] })
      .overrideProvider(queueConfig.KEY)
      .useValue({
        host: 'redis',
        port: 6379,
        prefix: 'bull-module-spec',
        videoJobAttempts: 3,
        videoJobBackoffMs: 30000,
      })
      .compile();

    expect(module.get(VideoQueueProducer)).toBeInstanceOf(VideoQueueProducer);
    expect(module.get(getQueueToken(VIDEO_PROCESSING_QUEUE))).toBeDefined();
    await module.close();
  });
});
