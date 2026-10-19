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

interface PartUrlsBody {
  urls: { part_number: number; url: string }[];
}

interface ListPartsBody {
  part_size_bytes: number;
  part_count: number;
  parts: { part_number: number; size_bytes: number; etag: string }[];
}

describe('GET /videos/:id/upload/parts (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let throttlerStorage: ThrottlerStorageService;
  let ownerToken: string;
  let otherToken: string;
  let videoId: string;

  beforeAll(async () => {
    app = await createVideosTestApp('streamtube-test-e2e-list-parts');
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

  const listParts = (id: string, token: string | null = ownerToken) => {
    const req = request(app.getHttpServer()).get(`/videos/${id}/upload/parts`);
    if (token !== null) req.set('Authorization', `Bearer ${token}`);
    return req;
  };

  it('lists-parts-sent-straight-to-storage', async () => {
    const urlsRes = await request(app.getHttpServer())
      .post(`/videos/${videoId}/upload/part-urls`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ part_numbers: [2, 1] })
      .expect(200);
    const sizes: Record<number, number> = { 1: 64 * MIB, 2: 6 * MIB };
    const etags: Record<number, string | null> = {};
    for (const { part_number, url } of bodyOf<PartUrlsBody>(urlsRes).urls) {
      const put = await fetch(url, {
        method: 'PUT',
        body: new Uint8Array(sizes[part_number]),
      });
      expect(put.ok).toBe(true);
      etags[part_number] = put.headers.get('etag');
    }

    const res = await listParts(videoId).expect(200);

    expect(bodyOf<ListPartsBody>(res)).toEqual({
      part_size_bytes: 64 * MIB,
      part_count: 2,
      parts: [
        { part_number: 1, size_bytes: sizes[1], etag: etags[1] },
        { part_number: 2, size_bytes: sizes[2], etag: etags[2] },
      ],
    });
  });

  it('no-part-sent-returns-empty-list', async () => {
    const res = await listParts(videoId).expect(200);

    expect(bodyOf<ListPartsBody>(res).parts).toEqual([]);
  });

  it('malformed-video-id-is-a-validation-error', async () => {
    const res = await listParts('not-a-uuid').expect(400);

    expect(bodyOf(res)).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('another-owner-is-not-found', async () => {
    const res = await listParts(videoId, otherToken).expect(404);

    expect(bodyOf(res)).toMatchObject({ error: 'VIDEO_NOT_FOUND' });
  });

  it('unknown-id-is-not-found', async () => {
    const res = await listParts(randomUUID()).expect(404);

    expect(bodyOf(res)).toMatchObject({ error: 'VIDEO_NOT_FOUND' });
  });

  it('video-not-in-draft-is-a-conflict', async () => {
    await dataSource
      .getRepository(Video)
      .update(videoId, { status: VideoStatus.PROCESSING });

    const res = await listParts(videoId).expect(409);

    expect(bodyOf(res)).toMatchObject({ error: 'VIDEO_NOT_IN_DRAFT' });
  });

  it('request-without-token-is-unauthorized', async () => {
    await listParts(videoId, null).expect(401);
  });
});
