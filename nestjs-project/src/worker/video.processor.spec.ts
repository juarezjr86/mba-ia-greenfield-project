import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import { UnsupportedMediaError } from '../media/media.errors';
import type { ProcessVideoJobData } from '../queue/queue.constants';
import type { VideoProcessingService } from './video-processing.service';
import { VideoProcessor } from './video.processor';

function job(
  attemptsMade: number,
  attempts?: number,
): Job<ProcessVideoJobData> {
  return {
    data: { videoId: 'video-1' },
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<ProcessVideoJobData>;
}

describe('VideoProcessor', () => {
  beforeAll(() => {
    // The listener logs every terminal failure; keep the test output clean.
    Logger.overrideLogger(false);
  });

  let processing: { process: jest.Mock; markFailed: jest.Mock };
  let processor: VideoProcessor;

  beforeEach(() => {
    processing = {
      process: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    processor = new VideoProcessor(
      processing as unknown as VideoProcessingService,
    );
  });

  describe('process', () => {
    it('delegates the video id of the job', async () => {
      await processor.process(job(0, 3));

      expect(processing.process).toHaveBeenCalledWith('video-1');
    });

    it('turns UnsupportedMediaError into UnrecoverableError, keeping the message', async () => {
      processing.process.mockRejectedValue(
        new UnsupportedMediaError('Invalid data found'),
      );

      const failure = await processor
        .process(job(0, 3))
        .catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(UnrecoverableError);
      expect((failure as Error).message).toBe('Invalid data found');
    });

    it('lets any other error through so the queue retries it', async () => {
      processing.process.mockRejectedValue(new Error('network'));

      await expect(processor.process(job(0, 3))).rejects.toThrow('network');
    });
  });

  describe('onFailed', () => {
    it('does not mark the video failed while attempts are left', async () => {
      await processor.onFailed(job(1, 3), new Error('network'));
      await processor.onFailed(job(2, 3), new Error('network'));

      expect(processing.markFailed).not.toHaveBeenCalled();
    });

    it('marks the video failed after the last attempt', async () => {
      await processor.onFailed(job(3, 3), new Error('network'));

      expect(processing.markFailed).toHaveBeenCalledWith('video-1', 'network');
    });

    it('treats a job without attempts as a single attempt', async () => {
      await processor.onFailed(job(1, undefined), new Error('boom'));

      expect(processing.markFailed).toHaveBeenCalledWith('video-1', 'boom');
    });

    it('marks the video failed at once on an UnrecoverableError', async () => {
      await processor.onFailed(job(1, 3), new UnrecoverableError('corrupt'));

      expect(processing.markFailed).toHaveBeenCalledWith('video-1', 'corrupt');
    });

    it('recognizes an unrecoverable error by name as well', async () => {
      const error = new Error('corrupt');
      error.name = 'UnrecoverableError';

      await processor.onFailed(job(1, 3), error);

      expect(processing.markFailed).toHaveBeenCalledTimes(1);
    });

    it('ignores an event without a job', async () => {
      await processor.onFailed(undefined, new Error('stalled'));

      expect(processing.markFailed).not.toHaveBeenCalled();
    });

    it('never throws when marking the video fails', async () => {
      processing.markFailed.mockRejectedValue(new Error('database down'));

      await expect(
        processor.onFailed(job(3, 3), new Error('network')),
      ).resolves.toBeUndefined();
    });
  });
});
