import { UnrecoverableError } from 'bullmq';
import type { Repository } from 'typeorm';
import type videosConfig from '../config/videos.config';
import type { ConfigType } from '@nestjs/config';
import { MediaToolError, UnsupportedMediaError } from '../media/media.errors';
import type { MediaToolsService } from '../media/media-tools.service';
import type { MediaMetadata } from '../media/probe-mapper';
import type { StorageService } from '../storage/storage.service';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import {
  thumbnailKeyFor,
  VideoProcessingService,
} from './video-processing.service';

const config: ConfigType<typeof videosConfig> = {
  uploadPartSizeBytes: 64 * 1024 * 1024,
  uploadMaxSizeBytes: 10 * 1024 * 1024 * 1024,
  partUrlsMaxBatch: 100,
  presignPartExpiresSeconds: 3600,
  presignGetExpiresSeconds: 900,
  throttleLimit: 120,
  throttleTtlMs: 60000,
  mediaToolTimeoutMs: 600000,
};

const metadata: MediaMetadata = {
  duration_seconds: 30,
  container_format: 'mov,mp4,m4a,3gp,3g2,mj2',
  video_codec: 'h264',
  width: 1280,
  height: 720,
  bitrate: 800000,
  fps: 25,
  ffprobe_metadata: { format: { duration: '30.0' } },
};

describe('VideoProcessingService', () => {
  let repository: { findOneBy: jest.Mock; update: jest.Mock };
  let storage: {
    headObject: jest.Mock;
    presignGet: jest.Mock;
    putObject: jest.Mock;
    downloadToFile: jest.Mock;
  };
  let media: { probe: jest.Mock; extractThumbnail: jest.Mock };
  let service: VideoProcessingService;

  const video = (overrides: Partial<Video> = {}): Video =>
    ({
      id: 'video-1',
      status: VideoStatus.PROCESSING,
      storage_key: 'videos/video-1/original.mp4',
      ...overrides,
    }) as Video;
  const thumbnail = Buffer.from([0xff, 0xd8, 0xff]);

  beforeEach(() => {
    repository = {
      findOneBy: jest.fn().mockResolvedValue(video()),
      update: jest.fn().mockResolvedValue(undefined),
    };
    storage = {
      headObject: jest
        .fn()
        .mockResolvedValue({ sizeBytes: 10, contentType: 'video/mp4' }),
      presignGet: jest.fn().mockResolvedValue('http://storage:9000/signed'),
      putObject: jest.fn().mockResolvedValue(undefined),
      downloadToFile: jest.fn().mockResolvedValue(undefined),
    };
    media = {
      probe: jest.fn().mockResolvedValue(metadata),
      extractThumbnail: jest.fn().mockResolvedValue(thumbnail),
    };
    service = new VideoProcessingService(
      repository as unknown as Repository<Video>,
      storage as unknown as StorageService,
      media as unknown as MediaToolsService,
      config,
    );
  });

  describe('process', () => {
    it('stores the thumbnail and marks the video ready with all metadata', async () => {
      await service.process('video-1');

      expect(storage.presignGet).toHaveBeenCalledWith(
        'videos/video-1/original.mp4',
        { expiresIn: 1260, client: 'internal' },
      );
      expect(media.probe).toHaveBeenCalledWith('http://storage:9000/signed');
      expect(media.extractThumbnail).toHaveBeenCalledWith(
        'http://storage:9000/signed',
        30,
      );
      expect(storage.putObject).toHaveBeenCalledWith(
        'thumbnails/video-1/default.jpg',
        thumbnail,
        'image/jpeg',
      );
      expect(repository.update).toHaveBeenCalledWith(
        'video-1',
        expect.objectContaining({
          duration_seconds: 30,
          container_format: 'mov,mp4,m4a,3gp,3g2,mj2',
          video_codec: 'h264',
          width: 1280,
          height: 720,
          bitrate: 800000,
          fps: 25,
          ffprobe_metadata: metadata.ffprobe_metadata,
          thumbnail_key: 'thumbnails/video-1/default.jpg',
          status: VideoStatus.READY,
          failure_reason: null,
        }),
      );
    });

    it('stores the thumbnail before it marks the video ready', async () => {
      const order: string[] = [];
      storage.putObject.mockImplementation(() => {
        order.push('putObject');
        return Promise.resolve();
      });
      repository.update.mockImplementation(() => {
        order.push('update');
        return Promise.resolve();
      });

      await service.process('video-1');

      expect(order).toEqual(['putObject', 'update']);
    });

    it('does nothing for a video that is already ready', async () => {
      repository.findOneBy.mockResolvedValue(
        video({ status: VideoStatus.READY }),
      );

      await service.process('video-1');

      expect(storage.headObject).not.toHaveBeenCalled();
      expect(media.probe).not.toHaveBeenCalled();
      expect(storage.putObject).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('reprocesses a failed video (a manual re-enqueue)', async () => {
      repository.findOneBy.mockResolvedValue(
        video({ status: VideoStatus.FAILED }),
      );

      await service.process('video-1');

      expect(repository.update).toHaveBeenCalledWith(
        'video-1',
        expect.objectContaining({ status: VideoStatus.READY }),
      );
    });

    it('throws UnrecoverableError when the video row is missing', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.process('video-1')).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
      expect(storage.headObject).not.toHaveBeenCalled();
    });

    it('throws UnrecoverableError for a video that is still a draft', async () => {
      repository.findOneBy.mockResolvedValue(
        video({ status: VideoStatus.DRAFT }),
      );

      await expect(service.process('video-1')).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
      expect(media.probe).not.toHaveBeenCalled();
    });

    it('throws UnrecoverableError when the object is missing in storage', async () => {
      storage.headObject.mockResolvedValue(null);

      await expect(service.process('video-1')).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
      expect(media.probe).not.toHaveBeenCalled();
    });

    it('lets UnsupportedMediaError through without the download fallback', async () => {
      media.probe.mockRejectedValue(new UnsupportedMediaError('corrupt'));

      await expect(service.process('video-1')).rejects.toBeInstanceOf(
        UnsupportedMediaError,
      );
      expect(storage.downloadToFile).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    });

    describe('when reading the object over its URL fails with a MediaToolError', () => {
      beforeEach(() => {
        media.probe.mockImplementation((input: string) =>
          input.startsWith('http')
            ? Promise.reject(new MediaToolError('connection reset'))
            : Promise.resolve(metadata),
        );
      });

      it('downloads the object once and runs the tools on the local copy', async () => {
        await service.process('video-1');

        expect(storage.downloadToFile).toHaveBeenCalledTimes(1);
        const [key, localPath] = storage.downloadToFile.mock.calls[0] as [
          string,
          string,
        ];
        expect(key).toBe('videos/video-1/original.mp4');
        expect(media.probe).toHaveBeenLastCalledWith(localPath);
        expect(media.extractThumbnail).toHaveBeenCalledWith(localPath, 30);
        expect(repository.update).toHaveBeenCalledWith(
          'video-1',
          expect.objectContaining({ status: VideoStatus.READY }),
        );
      });

      it('lets the error stand when the fallback fails too', async () => {
        media.probe.mockRejectedValue(new MediaToolError('still failing'));

        await expect(service.process('video-1')).rejects.toBeInstanceOf(
          MediaToolError,
        );
        expect(storage.downloadToFile).toHaveBeenCalledTimes(1);
        expect(repository.update).not.toHaveBeenCalled();
      });

      it('lets the error of the downloaded copy stand when the download fails', async () => {
        storage.downloadToFile.mockRejectedValue(new Error('disk full'));

        await expect(service.process('video-1')).rejects.toThrow('disk full');
        expect(repository.update).not.toHaveBeenCalled();
      });
    });
  });

  describe('markFailed', () => {
    it('updates only a video that is still processing', async () => {
      await service.markFailed('video-1', 'corrupt file');

      expect(repository.update).toHaveBeenCalledWith(
        { id: 'video-1', status: VideoStatus.PROCESSING },
        { status: VideoStatus.FAILED, failure_reason: 'corrupt file' },
      );
    });

    it('truncates a very long reason', async () => {
      await service.markFailed('video-1', 'x'.repeat(5000));

      const [, values] = repository.update.mock.calls[0] as [
        unknown,
        { failure_reason: string },
      ];
      expect(values.failure_reason).toHaveLength(1000);
    });
  });

  it('builds the thumbnail key from the video id', () => {
    expect(thumbnailKeyFor('abc')).toBe('thumbnails/abc/default.jpg');
  });
});
