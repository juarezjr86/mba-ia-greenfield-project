import { S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import type { ConfigType } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import { StorageService } from './storage.service';

const config: ConfigType<typeof storageConfig> = {
  endpoint: 'http://storage:9000',
  publicEndpoint: 'http://localhost:9000',
  region: 'us-east-1',
  bucket: 'streamtube',
  accessKey: 'access',
  secretKey: 'secret',
  corsAllowedOrigins: 'http://a.test, http://b.test',
};

function makeClient(endpoint: string): S3Client {
  return new S3Client({
    region: config.region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: 'access', secretAccessKey: 'secret' },
  });
}

function s3Error(name: string, httpStatusCode: number): S3ServiceException {
  return new S3ServiceException({
    name,
    $fault: 'client',
    $metadata: { httpStatusCode },
  });
}

describe('StorageService', () => {
  let internalClient: S3Client;
  let publicClient: S3Client;
  let service: StorageService;
  let internalSend: jest.SpyInstance;

  beforeEach(() => {
    internalClient = makeClient(config.endpoint);
    publicClient = makeClient(config.publicEndpoint);
    internalSend = jest.spyOn(internalClient, 'send');
    service = new StorageService(config, internalClient, publicClient);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('listAllParts', () => {
    it('follows pagination across truncated pages and returns the parts ordered', async () => {
      internalSend
        .mockResolvedValueOnce({
          Parts: [{ PartNumber: 2, Size: 5, ETag: '"b"' }],
          IsTruncated: true,
          NextPartNumberMarker: '2',
        })
        .mockResolvedValueOnce({
          Parts: [{ PartNumber: 3, Size: 7, ETag: '"c"' }],
          IsTruncated: false,
        });

      const parts = await service.listAllParts('k', 'u');

      expect(parts).toEqual([
        { partNumber: 2, sizeBytes: 5, etag: '"b"' },
        { partNumber: 3, sizeBytes: 7, etag: '"c"' },
      ]);
      expect(internalSend).toHaveBeenCalledTimes(2);
      const inputs = internalSend.mock.calls.map(
        ([command]: [{ input: Record<string, unknown> }]) => command.input,
      );
      expect(inputs[0].PartNumberMarker).toBeUndefined();
      expect(inputs[1].PartNumberMarker).toBe('2');
      expect(inputs[1].MaxParts).toBe(1000);
    });

    it('returns an empty list when storage holds no part', async () => {
      internalSend.mockResolvedValueOnce({ IsTruncated: false });

      await expect(service.listAllParts('k', 'u')).resolves.toEqual([]);
    });
  });

  describe('presigning', () => {
    it('signs part uploads and public GETs for the host of S3_PUBLIC_ENDPOINT', async () => {
      const part = await service.presignUploadPart('k', 'u', 1, 60);
      const get = await service.presignGet('k', {
        expiresIn: 60,
        client: 'public',
      });

      expect(new URL(part).host).toBe('localhost:9000');
      expect(new URL(get).host).toBe('localhost:9000');
    });

    it('signs internal GETs for the host of S3_ENDPOINT', async () => {
      const get = await service.presignGet('k', {
        expiresIn: 60,
        client: 'internal',
      });

      expect(new URL(get).host).toBe('storage:9000');
    });

    it('adds a response-content-disposition only when a download filename is given', async () => {
      const plain = await service.presignGet('k', {
        expiresIn: 60,
        client: 'public',
      });
      const download = await service.presignGet('k', {
        expiresIn: 60,
        client: 'public',
        downloadFilename: 'meu vídeo.mp4',
      });

      expect(
        new URL(plain).searchParams.has('response-content-disposition'),
      ).toBe(false);
      const disposition = new URL(download).searchParams.get(
        'response-content-disposition',
      );
      expect(disposition).toBe(
        `attachment; filename="meu v_deo.mp4"; filename*=UTF-8''meu%20v%C3%ADdeo.mp4`,
      );
    });
  });

  describe('headObject', () => {
    it('returns null on 404', async () => {
      internalSend.mockRejectedValueOnce(s3Error('NotFound', 404));

      await expect(service.headObject('k')).resolves.toBeNull();
    });

    it('rethrows any other storage error', async () => {
      internalSend.mockRejectedValueOnce(s3Error('Forbidden', 403));

      await expect(service.headObject('k')).rejects.toMatchObject({
        name: 'Forbidden',
      });
    });
  });

  describe('ensureBucket', () => {
    const commandNames = (): string[] =>
      internalSend.mock.calls.map(
        ([command]: [object]) => command.constructor.name,
      );

    it('creates the bucket only when HeadBucket answers 404, then applies CORS', async () => {
      internalSend
        .mockRejectedValueOnce(s3Error('NotFound', 404))
        .mockResolvedValue({});

      await service.ensureBucket();

      expect(commandNames()).toEqual([
        'HeadBucketCommand',
        'CreateBucketCommand',
        'PutBucketCorsCommand',
      ]);
      const [corsCommand] = internalSend.mock.calls[2] as [
        {
          input: {
            CORSConfiguration: { CORSRules: { AllowedOrigins: string[] }[] };
          };
        },
      ];
      expect(
        corsCommand.input.CORSConfiguration.CORSRules[0].AllowedOrigins,
      ).toEqual(['http://a.test', 'http://b.test']);
    });

    it('skips CreateBucket when the bucket already exists', async () => {
      internalSend.mockResolvedValue({});

      await service.ensureBucket();

      expect(commandNames()).toEqual([
        'HeadBucketCommand',
        'PutBucketCorsCommand',
      ]);
    });

    it('tolerates a concurrent creation of the bucket', async () => {
      internalSend
        .mockRejectedValueOnce(s3Error('NotFound', 404))
        .mockRejectedValueOnce(s3Error('BucketAlreadyOwnedByYou', 409))
        .mockResolvedValue({});

      await expect(service.ensureBucket()).resolves.toBeUndefined();
      expect(commandNames()).toContain('PutBucketCorsCommand');
    });

    it('rethrows errors that are not "bucket absent"', async () => {
      internalSend.mockRejectedValueOnce(s3Error('Forbidden', 403));

      await expect(service.ensureBucket()).rejects.toMatchObject({
        name: 'Forbidden',
      });
      expect(commandNames()).toEqual(['HeadBucketCommand']);
    });
  });
});
