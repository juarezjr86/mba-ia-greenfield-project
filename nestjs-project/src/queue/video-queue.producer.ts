import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import queueConfig from '../config/queue.config';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_QUEUE,
  type ProcessVideoJobData,
} from './queue.constants';

@Injectable()
export class VideoQueueProducer {
  constructor(
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly queue: Queue<ProcessVideoJobData>,
    @Inject(queueConfig.KEY)
    private readonly config: ConfigType<typeof queueConfig>,
  ) {}

  /**
   * Enqueues the processing job of a video. The job id is the video id, so
   * enqueueing the same video again is ignored by the queue (idempotent).
   */
  async enqueueProcessing(videoId: string): Promise<void> {
    await this.queue.add(
      PROCESS_VIDEO_JOB,
      { videoId },
      {
        jobId: videoId,
        attempts: this.config.videoJobAttempts,
        backoff: {
          type: 'exponential',
          delay: this.config.videoJobBackoffMs,
        },
      },
    );
  }
}
