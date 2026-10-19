import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import queueConfig from '../config/queue.config';
import { VIDEO_PROCESSING_QUEUE } from './queue.constants';
import { VideoQueueProducer } from './video-queue.producer';

const videoProcessingQueue = BullModule.registerQueue({
  name: VIDEO_PROCESSING_QUEUE,
});

// No `@Processor` here: the consumer lives in the worker entrypoint only, so
// the API process never starts a Worker.
@Module({
  imports: [
    ConfigModule.forFeature(queueConfig),
    BullModule.forRootAsync({
      imports: [ConfigModule.forFeature(queueConfig)],
      inject: [queueConfig.KEY],
      useFactory: (config: ConfigType<typeof queueConfig>) => ({
        connection: { host: config.host, port: config.port },
        prefix: config.prefix,
      }),
    }),
    videoProcessingQueue,
  ],
  providers: [VideoQueueProducer],
  exports: [videoProcessingQueue, VideoQueueProducer],
})
export class QueueModule {}
