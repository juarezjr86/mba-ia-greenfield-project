import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import storageConfig from '../config/storage.config';
import videosConfig from '../config/videos.config';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import { generateMp4, jpegSize } from '../test/media-fixtures';
import { RangeCountingProxy } from '../test/range-counting-proxy';
import { MediaToolError, UnsupportedMediaError } from './media.errors';
import { MediaModule } from './media.module';
import { MediaToolsService } from './media-tools.service';

const MIB = 1024 * 1024;
const LARGE_FILE_MAX_READ_RATIO = 0.25;

function testStorageConfig(): ConfigType<typeof storageConfig> {
  return {
    ...storageConfig(),
    bucket: 'streamtube-test-media',
    publicEndpoint: 'http://storage:9000',
  };
}

describe('MediaToolsService (integration, real storage and tools)', () => {
  let module: TestingModule;
  let storage: StorageService;
  let media: MediaToolsService;
  let proxy: RangeCountingProxy;
  let cleanupClient: S3Client;
  let workDir: string;
  const createdKeys: string[] = [];

  /** Uploads a local file and returns a presigned GET URL through the proxy. */
  async function publish(
    localPath: string,
    contentType = 'video/mp4',
  ): Promise<{ url: string; sizeBytes: number }> {
    const body = await readFile(localPath);
    return publishBytes(body, contentType);
  }

  async function publishBytes(
    body: Buffer,
    contentType = 'video/mp4',
  ): Promise<{ url: string; sizeBytes: number }> {
    const key = `test-media/${randomUUID()}/original.mp4`;
    createdKeys.push(key);
    await storage.putObject(key, body, contentType);
    const signed = await storage.presignGet(key, {
      expiresIn: 600,
      client: 'internal',
    });
    return { url: proxy.proxiedUrl(signed), sizeBytes: body.length };
  }

  beforeAll(async () => {
    const config = testStorageConfig();
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig, videosConfig],
        }),
        StorageModule,
        MediaModule,
      ],
    })
      .overrideProvider(storageConfig.KEY)
      .useValue(config)
      .compile();

    storage = module.get(StorageService);
    media = module.get(MediaToolsService);
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
    proxy = new RangeCountingProxy(config.endpoint);
    await proxy.start();
    workDir = await mkdtemp(join(tmpdir(), 'media-tools-spec-'));
  }, 30000);

  afterAll(async () => {
    for (const Key of createdKeys) {
      await cleanupClient.send(
        new DeleteObjectCommand({ Bucket: testStorageConfig().bucket, Key }),
      );
    }
    cleanupClient.destroy();
    await proxy.stop();
    await rm(workDir, { recursive: true, force: true });
    await module.close();
  });

  beforeEach(() => {
    proxy.reset();
  });

  describe('a generated 3 second MP4', () => {
    let url: string;
    let localPath: string;

    beforeAll(async () => {
      localPath = join(workDir, 'small.mp4');
      await generateMp4(localPath, { durationSeconds: 3 });
      ({ url } = await publish(localPath));
    }, 60000);

    it('probe returns the duration, size and codec of the video', async () => {
      const metadata = await media.probe(url);

      expect(metadata.duration_seconds).toBeGreaterThan(2.9);
      expect(metadata.duration_seconds).toBeLessThan(3.2);
      expect(metadata).toMatchObject({
        width: 1280,
        height: 720,
        video_codec: 'h264',
        fps: 25,
      });
      expect(metadata.container_format).toContain('mp4');
      expect(metadata.bitrate).toBeGreaterThan(0);
      expect(metadata.ffprobe_metadata.streams).toHaveLength(1);
    });

    it('probe also reads a local file path (the fallback input)', async () => {
      const metadata = await media.probe(localPath);

      expect(metadata).toMatchObject({ width: 1280, video_codec: 'h264' });
    });

    it('extractThumbnail returns a JPEG 640 pixels wide', async () => {
      const image = await media.extractThumbnail(url, 3);

      expect([image[0], image[1], image[2]]).toEqual([0xff, 0xd8, 0xff]);
      expect(jpegSize(image)).toEqual({ width: 640, height: 360 });
    });

    it('extractThumbnail works on a clip shorter than one second', async () => {
      const shortPath = join(workDir, 'short.mp4');
      await generateMp4(shortPath, { durationSeconds: 0.5 });
      const { url: shortUrl } = await publish(shortPath);

      const image = await media.extractThumbnail(shortUrl, 0.5);

      expect(jpegSize(image).width).toBe(640);
    });

    it('a presigned URL of a missing object is a retryable MediaToolError', async () => {
      const signed = await storage.presignGet(`test-media/${randomUUID()}/x`, {
        expiresIn: 60,
        client: 'internal',
      });

      const failure = await media
        .probe(proxy.proxiedUrl(signed))
        .catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(MediaToolError);
      // Recorded from the real tool, for the classification table.
      console.log(`ffprobe on a missing object: ${(failure as Error).message}`);
    });
  });

  describe('a generated MP4 of about 100 MB with the moov atom at the end', () => {
    it('probe plus extractThumbnail read only a small part of the object', async () => {
      const bigPath = join(workDir, 'big.mp4');
      await generateMp4(bigPath, {
        durationSeconds: 80,
        width: 640,
        height: 360,
        megabitsPerSecond: 10,
      });
      const { url, sizeBytes } = await publish(bigPath);
      expect(sizeBytes).toBeGreaterThan(90 * MIB);

      const metadata = await media.probe(url);
      const afterProbe = {
        bytes: proxy.bytesServed,
        gets: proxy.requests.length,
      };
      await media.extractThumbnail(url, metadata.duration_seconds!);

      const ratio = proxy.bytesServed / sizeBytes;
      // Recorded for progress.md (TD-07 smoke test against the real storage).
      console.log(
        [
          `object ${sizeBytes} bytes (${(sizeBytes / MIB).toFixed(1)} MiB)`,
          `probe: ${afterProbe.gets} GETs, ${afterProbe.bytes} bytes`,
          `probe + thumbnail: ${proxy.requests.length} GETs, ${proxy.bytesServed} bytes (${(ratio * 100).toFixed(2)}%)`,
          `ranges: ${proxy.requests.map((r) => `${r.range ?? 'none'}→${r.status}`).join(' | ')}`,
        ].join('\n'),
      );

      expect(metadata.duration_seconds).toBeGreaterThan(79.9);
      expect(proxy.requests.some((r) => r.status === 206)).toBe(true);
      expect(ratio).toBeLessThan(LARGE_FILE_MAX_READ_RATIO);
    }, 180000);
  });

  describe('failures', () => {
    it('bytes that are not a video raise UnsupportedMediaError, not MediaToolError', async () => {
      const { url } = await publishBytes(randomBytes(200 * 1024));

      const failure = await media.probe(url).catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(UnsupportedMediaError);
      expect(failure).not.toBeInstanceOf(MediaToolError);
      // Recorded from the real tool, for the classification table.
      console.log(`ffprobe on random bytes: ${(failure as Error).message}`);
    });

    it('a text file raises UnsupportedMediaError', async () => {
      const { url } = await publishBytes(Buffer.from('this is not a video\n'));

      await expect(media.probe(url)).rejects.toBeInstanceOf(
        UnsupportedMediaError,
      );
    });

    it('a stored playlist that points at a local file is not followed', async () => {
      // The .ts name passes ffmpeg's segment-extension check, so only the
      // protocol whitelist can refuse the file: URL.
      const secretPath = join(workDir, 'secret.ts');
      await writeFile(secretPath, 'do not leak');
      const playlist = `#EXTM3U
#EXT-X-TARGETDURATION:1
#EXTINF:1,
file://${secretPath}
#EXT-X-ENDLIST
`;
      const { url } = await publishBytes(Buffer.from(playlist));

      await expect(media.probe(url)).rejects.toBeInstanceOf(
        UnsupportedMediaError,
      );
      await expect(media.extractThumbnail(url, 1)).rejects.toThrow();
    });

    it('a downloaded playlist (local input) does not make the tools fetch URLs', async () => {
      const requested: string[] = [];
      const recorder = createServer((req, res) => {
        requested.push(req.url ?? '');
        res.end('x');
      });
      await new Promise<void>((resolve) =>
        recorder.listen(0, '127.0.0.1', resolve),
      );
      const { port } = recorder.address() as AddressInfo;
      const playlistPath = join(workDir, 'remote-segment.m3u8');
      await writeFile(
        playlistPath,
        `#EXTM3U
#EXT-X-TARGETDURATION:1
#EXTINF:1,
http://127.0.0.1:${port}/segment.ts
#EXT-X-ENDLIST
`,
      );

      try {
        await expect(media.probe(playlistPath)).rejects.toThrow();
        await expect(media.extractThumbnail(playlistPath, 1)).rejects.toThrow();
        expect(requested).toEqual([]);
      } finally {
        recorder.closeAllConnections();
        await new Promise<void>((resolve) => recorder.close(() => resolve()));
      }
    });

    describe('with a server that never answers', () => {
      let hangingServer: Server;
      let hangingUrl: string;

      beforeAll(async () => {
        hangingServer = createServer(() => {
          // Never responds: the tool waits until it is killed.
        });
        await new Promise<void>((resolve) =>
          hangingServer.listen(0, '127.0.0.1', resolve),
        );
        const { port } = hangingServer.address() as AddressInfo;
        hangingUrl = `http://127.0.0.1:${port}/video.mp4`;
      });

      afterAll(async () => {
        hangingServer.closeAllConnections();
        await new Promise<void>((resolve) =>
          hangingServer.close(() => resolve()),
        );
      });

      it('kills a tool that exceeds MEDIA_TOOL_TIMEOUT_MS and raises MediaToolError', async () => {
        const impatient = new MediaToolsService({
          ...videosConfig(),
          mediaToolTimeoutMs: 400,
        });
        const started = Date.now();

        await expect(impatient.probe(hangingUrl)).rejects.toThrow(
          /exceeded 400 ms/,
        );
        await expect(impatient.probe(hangingUrl)).rejects.toBeInstanceOf(
          MediaToolError,
        );
        await expect(
          impatient.extractThumbnail(hangingUrl, 10),
        ).rejects.toBeInstanceOf(MediaToolError);

        expect(Date.now() - started).toBeLessThan(10000);
      });
    });
  });
});
