import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import {
  bodyOf,
  createVideosTestApp,
  registerConfirmedUser,
} from './helpers/videos-e2e';

const MIB = 1024 * 1024;
const PART_URLS_MAX_BATCH = 100;

interface PartUrlsBody {
  urls: { part_number: number; url: string }[];
  expires_in: number;
}

describe('POST /videos/:id/upload/part-urls (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let throttlerStorage: ThrottlerStorageService;
  let ownerToken: string;
  let otherToken: string;
  let videoId: string;

  beforeAll(async () => {
    app = await createVideosTestApp('streamtube-test-e2e-part-urls');
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
    ({ accessToken: ownerToken } = await registerConfirmedUser(
      app,
      `owner_${randomUUID()}@example.com`,
    ));
    ({ accessToken: otherToken } = await registerConfirmedUser(
      app,
      `other_${randomUUID()}@example.com`,
    ));
    throttlerStorage.storage.clear();

    // 70 MiB with the default 64 MiB part size: a draft with 2 parts.
    const initiated = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        filename: 'aula.mp4',
        size_bytes: 70 * MIB,
        content_type: 'video/mp4',
      })
      .expect(201);
    videoId = bodyOf<{ id: string }>(initiated).id;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const partUrls = (
    id: string,
    body: object,
    token: string | null = ownerToken,
  ) => {
    const req = request(app.getHttpServer()).post(
      `/videos/${id}/upload/part-urls`,
    );
    if (token !== null) req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  };

  it('owner-gets-presigned-urls', async () => {
    const res = await partUrls(videoId, { part_numbers: [1, 2] }).expect(200);

    const body = bodyOf<PartUrlsBody>(res);
    expect(body.urls).toHaveLength(2);
    expect(body.urls.map((entry) => entry.part_number)).toEqual([1, 2]);
    for (const entry of body.urls) {
      expect(entry.url).toMatch(/^http:\/\/storage:9000\//);
    }
    expect(body.expires_in).toBe(3600);
  });

  it('returned-url-accepts-direct-put', async () => {
    const res = await partUrls(videoId, { part_numbers: [1] }).expect(200);
    const { url } = bodyOf<PartUrlsBody>(res).urls[0];

    const put = await fetch(url, {
      method: 'PUT',
      body: new Uint8Array(5 * MIB),
    });

    expect(put.ok).toBe(true);
    expect(put.headers.get('etag')).toEqual(expect.any(String));
  });

  it('part-number-above-part-count-is-rejected', async () => {
    const res = await partUrls(videoId, { part_numbers: [1, 3] }).expect(400);

    expect(bodyOf(res)).toMatchObject({ error: 'INVALID_PART_NUMBERS' });
  });

  it('batch-above-the-maximum-is-rejected', async () => {
    const res = await partUrls(videoId, {
      part_numbers: Array.from(
        { length: PART_URLS_MAX_BATCH + 1 },
        (_, i) => i + 1,
      ),
    }).expect(400);

    expect(bodyOf(res)).toMatchObject({ error: 'PART_URLS_BATCH_TOO_LARGE' });
  });

  it.each([
    ['empty-array', { part_numbers: [] }],
    ['missing-field', {}],
    ['zero', { part_numbers: [0] }],
    ['duplicates', { part_numbers: [1, 1] }],
    ['non-integer', { part_numbers: [1.5] }],
    ['unknown-field', { part_numbers: [1], extra: true }],
  ])('invalid-body-%s-is-a-validation-error', async (_name, body) => {
    const res = await partUrls(videoId, body).expect(400);

    expect(bodyOf(res)).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('malformed-video-id-is-a-validation-error', async () => {
    const res = await partUrls('not-a-uuid', { part_numbers: [1] }).expect(400);

    expect(bodyOf(res)).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('another-owner-is-not-found', async () => {
    const res = await partUrls(
      videoId,
      { part_numbers: [1] },
      otherToken,
    ).expect(404);

    expect(bodyOf(res)).toMatchObject({ error: 'VIDEO_NOT_FOUND' });
  });

  it('unknown-id-is-not-found', async () => {
    const res = await partUrls(randomUUID(), { part_numbers: [1] }).expect(404);

    expect(bodyOf(res)).toMatchObject({ error: 'VIDEO_NOT_FOUND' });
  });

  it('video-not-in-draft-is-a-conflict', async () => {
    await dataSource
      .getRepository(Video)
      .update(videoId, { status: VideoStatus.PROCESSING });

    const res = await partUrls(videoId, { part_numbers: [1] }).expect(409);

    expect(bodyOf(res)).toMatchObject({ error: 'VIDEO_NOT_IN_DRAFT' });
  });

  it('request-without-token-is-unauthorized', async () => {
    await partUrls(videoId, { part_numbers: [1] }, null).expect(401);
  });
});
