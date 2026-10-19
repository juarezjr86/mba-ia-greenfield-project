import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  DeleteObjectCommand,
  GetBucketCorsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

const MIB = 1024 * 1024;

// Presigned URLs are signed for the public endpoint, which from inside the
// nestjs-api container must be the Compose service address, not localhost.
function testConfig(): ConfigType<typeof storageConfig> {
  return {
    ...storageConfig(),
    bucket: 'streamtube-test',
    publicEndpoint: 'http://storage:9000',
  };
}

describe('StorageService (integration, real storage)', () => {
  let module: TestingModule;
  let storage: StorageService;
  let cleanupClient: S3Client;
  const createdKeys: string[] = [];

  const newKey = (suffix: string): string => {
    const key = `test-storage/${randomUUID()}/${suffix}`;
    createdKeys.push(key);
    return key;
  };

  beforeAll(async () => {
    const config = testConfig();
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    })
      .overrideProvider(storageConfig.KEY)
      .useValue(config)
      .compile();

    storage = module.get(StorageService);
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
  });

  afterAll(async () => {
    for (const Key of createdKeys) {
      await cleanupClient.send(
        new DeleteObjectCommand({ Bucket: testConfig().bucket, Key }),
      );
    }
    cleanupClient.destroy();
    await module.close();
  });

  it('ensureBucket is idempotent and leaves CORS exposing ETag', async () => {
    await storage.ensureBucket();
    await storage.ensureBucket();

    const { CORSRules } = await cleanupClient.send(
      new GetBucketCorsCommand({ Bucket: testConfig().bucket }),
    );

    expect(CORSRules).toHaveLength(1);
    expect(CORSRules![0].ExposeHeaders).toContain('ETag');
    expect(CORSRules![0].AllowedMethods).toEqual(
      expect.arrayContaining(['PUT', 'GET', 'HEAD']),
    );
  });

  describe('multipart upload', () => {
    const key = `test-storage/${randomUUID()}/original.mp4`;
    let uploadId: string;
    const part1 = randomBytes(5 * MIB);
    const part2 = randomBytes(1024);

    beforeAll(() => {
      createdKeys.push(key);
    });

    const putPart = async (
      partNumber: number,
      body: Buffer,
    ): Promise<Response> => {
      const url = await storage.presignUploadPart(
        key,
        uploadId,
        partNumber,
        300,
      );
      return fetch(url, { method: 'PUT', body: new Uint8Array(body) });
    };

    it('accepts presigned parts sent straight to storage and answers with an ETag', async () => {
      uploadId = await storage.createMultipartUpload(key, 'video/mp4');
      const url = await storage.presignUploadPart(key, uploadId, 1, 300);
      // Records whether the SDK put checksum parameters in the signed URL
      // (library-refs risk); printed so the outcome can be logged.
      console.info(
        'presigned UploadPart query keys:',
        [...new URL(url).searchParams.keys()].join(','),
      );

      const res1 = await putPart(1, part1);
      const res2 = await putPart(2, part2);

      expect(res1.status).toBe(200);
      expect(res1.headers.get('etag')).toBeTruthy();
      expect(res2.status).toBe(200);
      expect(res2.headers.get('etag')).toBeTruthy();
    });

    it('listAllParts returns the stored parts in order with their sizes', async () => {
      const parts = await storage.listAllParts(key, uploadId);

      expect(parts.map((p) => [p.partNumber, p.sizeBytes])).toEqual([
        [1, part1.length],
        [2, part2.length],
      ]);
      expect(parts.every((p) => p.etag.length > 0)).toBe(true);
    });

    it('completes the upload and headObject reports the sum of the parts', async () => {
      const parts = await storage.listAllParts(key, uploadId);

      await storage.completeMultipartUpload(
        key,
        uploadId,
        parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })),
      );

      await expect(storage.headObject(key)).resolves.toEqual({
        sizeBytes: part1.length + part2.length,
        contentType: 'video/mp4',
      });
    });

    it('presigned GET honors Range and answers 206 with Content-Range', async () => {
      const url = await storage.presignGet(key, {
        expiresIn: 300,
        client: 'public',
      });

      const res = await fetch(url, { headers: { Range: 'bytes=0-99' } });

      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe(
        `bytes 0-99/${part1.length + part2.length}`,
      );
      expect(Buffer.from(await res.arrayBuffer())).toEqual(
        part1.subarray(0, 100),
      );
    });

    it('presigned GET with a download filename answers Content-Disposition: attachment', async () => {
      const url = await storage.presignGet(key, {
        expiresIn: 300,
        client: 'public',
        downloadFilename: 'vídeo "férias".mp4',
      });

      const res = await fetch(url, { headers: { Range: 'bytes=0-9' } });

      const disposition = res.headers.get('content-disposition') ?? '';
      expect(disposition).toMatch(/^attachment;/);
      expect(disposition).toContain("filename*=UTF-8''v%C3%ADdeo");
      await res.arrayBuffer();
    });
  });

  it('putObject then downloadToFile round-trips the bytes', async () => {
    const key = newKey('default.jpg');
    const body = randomBytes(2048);
    const target = join(tmpdir(), `storage-it-${randomUUID()}.bin`);

    await storage.putObject(key, body, 'image/jpeg');
    await storage.downloadToFile(key, target);

    try {
      expect(await readFile(target)).toEqual(body);
      await expect(storage.headObject(key)).resolves.toMatchObject({
        sizeBytes: body.length,
        contentType: 'image/jpeg',
      });
    } finally {
      await rm(target, { force: true });
    }
  });

  it('headObject returns null for an object that does not exist', async () => {
    await expect(
      storage.headObject(`test-storage/${randomUUID()}/missing`),
    ).resolves.toBeNull();
  });
});
