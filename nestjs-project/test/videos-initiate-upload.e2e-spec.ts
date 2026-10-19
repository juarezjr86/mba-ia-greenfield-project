import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Video } from '../src/videos/entities/video.entity';
import { StorageService } from '../src/storage/storage.service';
import { buildSwaggerDocument } from '../src/swagger/swagger-document';
import { cleanAllTables } from '../src/test/create-test-data-source';
import {
  bodyOf,
  createVideosTestApp,
  registerConfirmedUser,
} from './helpers/videos-e2e';

const MIB = 1024 * 1024;
const UPLOAD_MAX_SIZE_BYTES = 10737418240;

interface InitiateBody {
  id: string;
  title: string;
  status: string;
  size_bytes: number;
  part_size_bytes: number;
  part_count: number;
}

describe('POST /videos (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let throttlerStorage: ThrottlerStorageService;
  let accessToken: string;

  beforeAll(async () => {
    app = await createVideosTestApp('streamtube-test-e2e-videos');
    dataSource = app.get(DataSource);
    throttlerStorage = app.get<ThrottlerStorageService>(ThrottlerStorage);
    await app.get(StorageService).ensureBucket();
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
    ({ accessToken } = await registerConfirmedUser(
      app,
      `uploader_${randomUUID()}@example.com`,
    ));
    throttlerStorage.storage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const validBody = {
    filename: 'aula.mp4',
    size_bytes: 12 * MIB,
    content_type: 'video/mp4',
  };

  const initiate = (body: object, token: string | null = accessToken) => {
    const req = request(app.getHttpServer()).post('/videos');
    if (token !== null) req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  };

  const countVideos = (): Promise<number> =>
    dataSource.getRepository(Video).count();

  describe('Initiate upload', () => {
    it('initiate-valid-request-creates-draft', async () => {
      const res = await initiate(validBody).expect(201);

      const body = bodyOf<InitiateBody>(res);
      expect(body.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(body.status).toBe('draft');
      expect(body.part_size_bytes).toEqual(expect.any(Number));
      expect(body.part_count).toEqual(expect.any(Number));
      expect(Object.keys(body)).not.toContain('upload_id');
      expect(Object.keys(body)).not.toContain('storage_key');

      const row = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ id: body.id });
      const me = bodyOf<{ sub: string }>(
        await request(app.getHttpServer())
          .get('/auth/me')
          .set('Authorization', `Bearer ${accessToken}`),
      );
      const ownerChannel = await dataSource.query<{ id: string }[]>(
        `SELECT "id" FROM "channels" WHERE "user_id" = $1`,
        [me.sub],
      );
      expect(row.channel_id).toBe(ownerChannel[0].id);
      expect(row.upload_id).toEqual(expect.any(String));
      expect(row.upload_id).not.toBe('');
    });

    it('title-defaults-to-filename-without-extension', async () => {
      const res = await initiate({
        filename: 'Aula 01.mp4',
        size_bytes: 12 * MIB,
        content_type: 'video/mp4',
      }).expect(201);

      const row = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ id: bodyOf<InitiateBody>(res).id });
      expect(row.title).toBe('Aula 01');
    });

    it('size-above-maximum-is-rejected', async () => {
      const res = await initiate({
        ...validBody,
        size_bytes: UPLOAD_MAX_SIZE_BYTES + 1,
      }).expect(400);

      expect(bodyOf(res).error).toBe('UPLOAD_SIZE_EXCEEDED');
      await expect(countVideos()).resolves.toBe(0);
    });

    it('invalid-content-type-is-rejected', async () => {
      const notVideo = await initiate({
        ...validBody,
        content_type: 'image/png',
      }).expect(400);
      const tooLong = await initiate({
        ...validBody,
        content_type: `video/${'x'.repeat(122)}`,
      }).expect(400);

      expect(bodyOf(notVideo).error).toBe('VALIDATION_ERROR');
      expect(bodyOf(tooLong).error).toBe('VALIDATION_ERROR');
      await expect(countVideos()).resolves.toBe(0);
    });

    it('request-without-token-is-unauthorized', async () => {
      await initiate(validBody, null).expect(401);

      await expect(countVideos()).resolves.toBe(0);
    });

    it('ten-gib-file-respects-multipart-limits', async () => {
      const res = await initiate({
        ...validBody,
        size_bytes: 10 * 1024 * MIB,
      }).expect(201);

      const body = bodyOf<InitiateBody>(res);
      expect(body.part_count).toBeLessThanOrEqual(10000);
      expect(body.part_size_bytes).toBeGreaterThanOrEqual(5 * MIB);
    });

    it('storage-failure-leaves-no-draft', async () => {
      jest
        .spyOn(app.get(StorageService), 'createMultipartUpload')
        .mockRejectedValueOnce(new Error('storage down'));

      const res = await initiate(validBody);

      expect(res.status).not.toBe(201);
      await expect(countVideos()).resolves.toBe(0);
    });

    it('throttle-is-independent-of-global-limit', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        statuses.push((await initiate(validBody)).status);
      }

      expect(statuses).toHaveLength(11);
      expect(statuses).not.toContain(429);

      const document = buildSwaggerDocument(app);
      const responses = document.paths['/videos'].post?.responses ?? {};
      expect(Object.keys(responses)).toContain('429');
    });
  });
});
