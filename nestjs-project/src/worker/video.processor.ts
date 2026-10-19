import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { UnsupportedMediaError } from '../media/media.errors';
import {
  VIDEO_PROCESSING_QUEUE,
  type ProcessVideoJobData,
} from '../queue/queue.constants';
import { VideoProcessingService } from './video-processing.service';

function isUnrecoverable(error: Error): boolean {
  return (
    error instanceof UnrecoverableError || error.name === 'UnrecoverableError'
  );
}

// Lock: the default `lockDuration` (30 s) is renewed every 15 s by the worker's
// event loop, which stays free while ffprobe/ffmpeg run as child processes and
// the download is a stream, so a job of several minutes keeps its lock.
@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(private readonly processing: VideoProcessingService) {
    super();
  }

  async process(job: Job<ProcessVideoJobData>): Promise<void> {
    try {
      await this.processing.process(job.data.videoId);
    } catch (err) {
      // The same bytes fail the same way: do not retry.
      if (err instanceof UnsupportedMediaError) {
        throw new UnrecoverableError(err.message);
      }
      throw err;
    }
  }

  /** Positive evidence of a clean stop: the Worker finished its active job. */
  @OnWorkerEvent('closed')
  onClosed(): void {
    this.logger.log('Worker closed');
  }

  /**
   * BullMQ emits `failed` after every failed attempt, once `attemptsMade` has
   * already been incremented (the same test `Job.shouldRetryJob` applies). The
   * video becomes `failed` only when no retry is left.
   *
   * A job that stalls past `maxStalledCount` (the worker process died too many
   * times) also reaches this listener: BullMQ 6 sends it back to the queue
   * marked with a deferred failure, and the next Worker to take it fails it
   * with an `UnrecoverableError` (`worker.js`, `getUnrecoverableErrorMessage`).
   * Proved by `video.processor.integration-spec.ts`.
   */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<ProcessVideoJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) {
      this.logger.warn(`A job failed without a job record: ${error.message}`);
      return;
    }

    const { videoId } = job.data;
    const maxAttempts = job.opts.attempts ?? 1;
    if (!isUnrecoverable(error) && job.attemptsMade < maxAttempts) {
      this.logger.warn(
        `Processing of video ${videoId} failed (attempt ${job.attemptsMade} of ${maxAttempts}), will retry: ${error.message}`,
      );
      return;
    }

    // An event listener must not throw: a rejection here would end the worker.
    try {
      await this.processing.markFailed(videoId, error.message);
      this.logger.error(
        `Video ${videoId} failed after ${job.attemptsMade} attempt(s): ${error.message}`,
      );
    } catch (markError) {
      this.logger.error(
        `Could not mark video ${videoId} as failed: ${String(markError)}`,
      );
    }
  }
}
