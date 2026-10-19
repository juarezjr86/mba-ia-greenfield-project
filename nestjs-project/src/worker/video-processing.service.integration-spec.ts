import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UnrecoverableError } from 'bullmq';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import storageConfig from '../config/storage.config';
import videosConfig from '../config/videos.config';
import { UnsupportedMediaError } from '../media/media.errors';
import { MediaModule } from '../media/media.module';
import { MediaToolsService } from '../media/media-tools.service';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import { createProcessingVideo } from '../test/create-processing-video';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { generateMp4, jpegSize, notAVideo } from '../test/media-fixtures';
import { User } from '../users/entities/user.entity';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import { VideoProcessingService } from './video-processing.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];
const BUCKET = 'streamtube-test-worker';

// Real ffprobe/ffmpeg over presigned URLs: about 3 s on an idle machine, over
// the 5 s Jest default when the host is busy.
jest.setTimeout(60_000);

function testStorageConfig(): ConfigType<typeof storageConfig> {
  return {
    ...storageConfig(),
    bucket: BUCKET,
    publicEndpoint: 'http://storage:9000',
  };
}

describe('VideoProcessingService (integration, real database, storage and tools)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let storage: StorageService;
  let media: MediaToolsService;
  let service: VideoProcessingService;
  let cleanupClient: S3Client;
  let workDir: string;
  let validMp4: Buffer;

  const rowOf = (id: string): Promise<Video> =>
    dataSource.getRepository(Video).findOneByOrFail({ id });

  const fallbackDirectories = async (): Promise<string[]> =>
    (await readdir(tmpdir())).filter((name) =>
      name.startsWith('video-fallback-'),
    );

  beforeAll(async () => {
    const config = testStorageConfig();
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig, videosConfig],
        }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        TypeOrmModule.forFeature([Video]),
        StorageModule,
        MediaModule,
      ],
      providers: [VideoProcessingService],
    })
      .overrideProvider(storageConfig.KEY)
      .useValue(config)
      .compile();

    dataSource = module.get(DataSource);
    storage = module.get(StorageService);
    media = module.get(MediaToolsService);
    service = module.get(VideoProcessingService);
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

    workDir = await mkdtemp(join(tmpdir(), 'worker-spec-'));
    const mp4Path = join(workDir, 'valid.mp4');
    await generateMp4(mp4Path, { durationSeconds: 3 });
    validMp4 = await readFile(mp4Path);
  }, 60000);

  afterAll(async () => {
    const { rows } = {
      rows: await dataSource.query<
        { storage_key: string; thumbnail_key: string | null }[]
      >('SELECT storage_key, thumbnail_key FROM videos'),
    };
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
    await rm(workDir, { recursive: true, force: true });
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('turns a processing video with a valid MP4 into ready, with metadata and a stored JPEG', async () => {
    const { id } = await createProcessingVideo(dataSource, storage, validMp4);

    await service.process(id);

    const row = await rowOf(id);
    expect(row.status).toBe(VideoStatus.READY);
    expect(row.duration_seconds).toBeGreaterThan(2.9);
    expect(row.duration_seconds).toBeLessThan(3.2);
    expect(row).toMatchObject({
      width: 1280,
      height: 720,
      video_codec: 'h264',
      fps: 25,
      thumbnail_key: `thumbnails/${id}/default.jpg`,
      failure_reason: null,
    });
    expect(row.container_format).toContain('mp4');
    expect(row.bitrate).toBeGreaterThan(0);
    expect(row.ffprobe_metadata).toMatchObject({
      streams: [expect.objectContaining({ codec_name: 'h264' })],
    });

    const stored = await storage.headObject(row.thumbnail_key!);
    expect(stored).toMatchObject({ contentType: 'image/jpeg' });
    expect(stored!.sizeBytes).toBeGreaterThan(0);
    const url = await storage.presignGet(row.thumbnail_key!, {
      expiresIn: 60,
      client: 'internal',
    });
    const image = Buffer.from(await (await fetch(url)).arrayBuffer());
    expect(jpegSize(image).width).toBe(640);
  });

  it('is a no-op the second time: same keys, nothing rewritten', async () => {
    const { id } = await createProcessingVideo(dataSource, storage, validMp4);
    await service.process(id);
    const first = await rowOf(id);
    const probe = jest.spyOn(media, 'probe');
    const put = jest.spyOn(storage, 'putObject');

    await service.process(id);

    const second = await rowOf(id);
    expect(second.status).toBe(VideoStatus.READY);
    expect(second.thumbnail_key).toBe(first.thumbnail_key);
    expect(second.updated_at).toEqual(first.updated_at);
    expect(probe).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('reprocesses a processing video under the same keys', async () => {
    const { id } = await createProcessingVideo(dataSource, storage, validMp4);
    await service.process(id);
    await dataSource
      .getRepository(Video)
      .update(id, { status: VideoStatus.PROCESSING });

    await service.process(id);

    const row = await rowOf(id);
    expect(row.status).toBe(VideoStatus.READY);
    expect(row.thumbnail_key).toBe(`thumbnails/${id}/default.jpg`);
  });

  it('gives the same result through the download fallback when the URL read fails', async () => {
    const direct = await createProcessingVideo(dataSource, storage, validMp4);
    await service.process(direct.id);
    const expected = await rowOf(direct.id);

    const fallback = await createProcessingVideo(dataSource, storage, validMp4);
    // A real connection failure, so the MediaToolError is genuine and the tools
    // then run for real on the downloaded copy.
    jest
      .spyOn(storage, 'presignGet')
      .mockResolvedValue('http://127.0.0.1:1/unreachable.mp4');
    const download = jest.spyOn(storage, 'downloadToFile');
    const directoriesBefore = await fallbackDirectories();

    await service.process(fallback.id);

    const row = await rowOf(fallback.id);
    expect(download).toHaveBeenCalledTimes(1);
    expect(row.status).toBe(VideoStatus.READY);
    expect(row).toMatchObject({
      duration_seconds: expected.duration_seconds,
      container_format: expected.container_format,
      video_codec: expected.video_codec,
      width: expected.width,
      height: expected.height,
      bitrate: expected.bitrate,
      fps: expected.fps,
      thumbnail_key: `thumbnails/${fallback.id}/default.jpg`,
    });
    // The temporary copy is gone.
    expect(await fallbackDirectories()).toEqual(directoriesBefore);
  });

  it('rejects a corrupt file with UnsupportedMediaError and no download fallback', async () => {
    const { id } = await createProcessingVideo(
      dataSource,
      storage,
      notAVideo(),
    );
    const download = jest.spyOn(storage, 'downloadToFile');

    await expect(service.process(id)).rejects.toBeInstanceOf(
      UnsupportedMediaError,
    );

    expect(download).not.toHaveBeenCalled();
    expect((await rowOf(id)).status).toBe(VideoStatus.PROCESSING);
  });

  it('markFailed records a reason without any presigned URL in it', async () => {
    const { id } = await createProcessingVideo(
      dataSource,
      storage,
      notAVideo(),
    );
    const failure = await service.process(id).catch((e: unknown) => e);

    await service.markFailed(id, (failure as Error).message);

    const row = await rowOf(id);
    expect(row.status).toBe(VideoStatus.FAILED);
    expect(row.failure_reason).toContain('Invalid data found');
    expect(row.failure_reason).not.toContain('X-Amz-');
    expect(row.failure_reason).not.toContain('http');
  });

  it('throws UnrecoverableError when the object is missing in storage', async () => {
    const { id } = await createProcessingVideo(dataSource, storage, validMp4, {
      storage_key: `videos/${randomUUID()}/never-uploaded.mp4`,
    });

    await expect(service.process(id)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('throws UnrecoverableError when the video row does not exist', async () => {
    await expect(service.process(randomUUID())).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('never moves a ready video back to failed', async () => {
    const { id } = await createProcessingVideo(dataSource, storage, validMp4);
    await service.process(id);

    await service.markFailed(id, 'a late event');

    const row = await rowOf(id);
    expect(row.status).toBe(VideoStatus.READY);
    expect(row.failure_reason).toBeNull();
  });
});
