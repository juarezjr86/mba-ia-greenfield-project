import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import {
  VIDEO_PROCESSING_QUEUE,
  type ProcessVideoJobData,
} from '../src/queue/queue.constants';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import {
  bodyOf,
  createVideosTestApp,
  registerConfirmedUser,
} from './helpers/videos-e2e';

const MIB = 1024 * 1024;
const PART_SIZE = 5 * MIB;
// Two 5 MiB parts and a short last part.
const FULL_SIZES = [PART_SIZE, PART_SIZE, 1024];
const SIZE = FULL_SIZES.reduce((sum, size) => sum + size, 0);

interface PartUrlsBody {
  urls: { part_number: number; url: string }[];
}

describe('POST /videos/:id/upload/complete (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let storage: StorageService;
  let queue: Queue<ProcessVideoJobData>;
  let throttlerStorage: ThrottlerStorageService;
  let ownerToken: string;
  let otherToken: string;

  beforeAll(async () => {
    // 5 MiB parts (the S3 minimum) so a small file still has 3 parts.
    app = await createVideosTestApp('streamtube-test-e2e-complete', {
      videos: { uploadPartSizeBytes: PART_SIZE },
    });
    dataSource = app.get(DataSource);
    storage = app.get(StorageService);
    queue = app.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
    throttlerStorage = app.get<ThrottlerStorageService>(ThrottlerStorage);
    await storage.ensureBucket();
  }, 60000);

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await queue.obliterate({ force: true });
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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function initiateDraft(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set(auth(ownerToken))
      .send({
        filename: 'aula.mp4',
        size_bytes: SIZE,
        content_type: 'video/mp4',
      })
      .expect(201);
    expect(bodyOf<{ part_count: number }>(res).part_count).toBe(3);
    return bodyOf<{ id: string }>(res).id;
  }

  /** Sends parts 1..sizes.length straight to storage through the API URLs. */
  async function sendParts(videoId: string, sizes: number[]): Promise<void> {
    const res = await request(app.getHttpServer())
      .post(`/videos/${videoId}/upload/part-urls`)
      .set(auth(ownerToken))
      .send({ part_numbers: sizes.map((_, index) => index + 1) })
      .expect(200);
    for (const { part_number, url } of bodyOf<PartUrlsBody>(res).urls) {
      const put = await fetch(url, {
        method: 'PUT',
        body: new Uint8Array(sizes[part_number - 1]),
      });
      expect(put.ok).toBe(true);
    }
  }

  const complete = (id: string, token: string | null = ownerToken) => {
    const req = request(app.getHttpServer()).post(
      `/videos/${id}/upload/complete`,
    );
    if (token !== null) req.set(auth(token));
    return req;
  };

  const rowOf = (id: string): Promise<Video> =>
    dataSource.getRepository(Video).findOneByOrFail({ id });

  const jobsOf = async (id: string): Promise<number> =>
    (await queue.getJobs()).filter((job) => job.id === id).length;

  it('complete-moves-video-to-processing', async () => {
    const id = await initiateDraft();
    await sendParts(id, FULL_SIZES);

    const res = await complete(id).expect(202);

    expect(bodyOf(res)).toEqual({ id, status: 'processing' });
    const row = await rowOf(id);
    expect(row.status).toBe(VideoStatus.PROCESSING);
    expect(row.upload_id).toBeNull();
    await expect(storage.headObject(row.storage_key)).resolves.toEqual(
      expect.objectContaining({ sizeBytes: SIZE }),
    );
    expect(await jobsOf(id)).toBe(1);
  });

  it('repeated-complete-does-not-create-a-second-job', async () => {
    const id = await initiateDraft();
    await sendParts(id, FULL_SIZES);

    await complete(id).expect(202);
    await complete(id).expect(202);

    expect(await jobsOf(id)).toBe(1);
  });

  it('parallel-complete-calls-both-succeed-with-one-job', async () => {
    const id = await initiateDraft();
    await sendParts(id, FULL_SIZES);

    const [first, second] = await Promise.all([complete(id), complete(id)]);

    expect([first.status, second.status]).toEqual([202, 202]);
    expect((await rowOf(id)).status).toBe(VideoStatus.PROCESSING);
    expect(await jobsOf(id)).toBe(1);
  });

  it('missing-parts-keep-draft', async () => {
    const id = await initiateDraft();
    await sendParts(id, [PART_SIZE]);

    const res = await complete(id).expect(409);

    expect(bodyOf(res)).toMatchObject({ error: 'UPLOAD_INCOMPLETE' });
    expect((await rowOf(id)).status).toBe(VideoStatus.DRAFT);
    expect(await jobsOf(id)).toBe(0);
  });

  it('size-mismatch-keeps-draft', async () => {
    const id = await initiateDraft();
    await sendParts(id, [PART_SIZE, PART_SIZE, 2048]);

    const res = await complete(id).expect(422);

    expect(bodyOf(res)).toMatchObject({ error: 'VIDEO_SIZE_MISMATCH' });
    expect((await rowOf(id)).status).toBe(VideoStatus.DRAFT);
    expect(await jobsOf(id)).toBe(0);
  });

  it.each([VideoStatus.READY, VideoStatus.FAILED])(
    '%s-video-is-already-processed',
    async (status) => {
      const id = await initiateDraft();
      await dataSource.getRepository(Video).update(id, { status });

      const res = await complete(id).expect(409);

      expect(bodyOf(res)).toMatchObject({ error: 'VIDEO_ALREADY_PROCESSED' });
    },
  );

  it('object-finalized-by-an-earlier-failed-call-is-recovered', async () => {
    const id = await initiateDraft();
    await sendParts(id, FULL_SIZES);
    const draft = await rowOf(id);
    const parts = await storage.listAllParts(
      draft.storage_key,
      draft.upload_id!,
    );
    await storage.completeMultipartUpload(
      draft.storage_key,
      draft.upload_id!,
      parts.map(({ partNumber, etag }) => ({ partNumber, etag })),
    );

    const res = await complete(id).expect(202);

    expect(bodyOf(res)).toEqual({ id, status: 'processing' });
    expect((await rowOf(id)).status).toBe(VideoStatus.PROCESSING);
    expect(await jobsOf(id)).toBe(1);
  });

  it('malformed-video-id-is-a-validation-error', async () => {
    const res = await complete('not-a-uuid').expect(400);

    expect(bodyOf(res)).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('another-owner-is-not-found', async () => {
    const id = await initiateDraft();

    const res = await complete(id, otherToken).expect(404);

    expect(bodyOf(res)).toMatchObject({ error: 'VIDEO_NOT_FOUND' });
  });

  it('unknown-id-is-not-found', async () => {
    await complete(randomUUID()).expect(404);
  });

  it('request-without-token-is-unauthorized', async () => {
    const id = await initiateDraft();

    await complete(id, null).expect(401);
  });
});
