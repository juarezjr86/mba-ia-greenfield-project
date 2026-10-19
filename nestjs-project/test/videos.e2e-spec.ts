import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { generateMp4 } from '../src/test/media-fixtures';
import { VideoStatus } from '../src/videos/entities/video.entity';
import {
  bodyOf,
  createVideosTestApp,
  registerConfirmedUser,
} from './helpers/videos-e2e';

const MIB = 1024 * 1024;
const PART_SIZE = 5 * MIB;
const POLL_INTERVAL_MS = 1000;
const READY_TIMEOUT_MS = 90_000;
// A JSON request to the API is a few hundred bytes; a part is at least 5 MiB.
const MAX_API_REQUEST_BYTES = 4096;

interface InitiateBody {
  id: string;
  part_size_bytes: number;
  part_count: number;
}
interface PartUrlsBody {
  urls: { part_number: number; url: string }[];
}
interface VideoBody {
  id: string;
  status: VideoStatus;
  original_filename: string;
  size_bytes: number;
  duration_seconds: number | null;
  video_codec: string | null;
  width: number | null;
  failure_reason: string | null;
}
interface UrlBody {
  url: string;
  expires_in: number;
  filename?: string;
}
interface RecordedRequest {
  method: string;
  contentType: string | undefined;
  contentLength: number;
  chunked: boolean;
}

describe('Upload and processing flow (e2e, real services)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let storage: StorageService;
  let queue: Queue<ProcessVideoJobData>;
  let throttlerStorage: ThrottlerStorageService;
  let ownerToken: string;
  let otherToken: string;
  let workDir: string;
  let filePath: string;
  let fileSize: number;
  const apiRequests: RecordedRequest[] = [];

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'videos-e2e-'));
    filePath = join(workDir, 'aula.mp4');
    // Noise at 4 Mb/s for 20 s: about 10 MB, so 5 MiB parts give 2 or 3 parts.
    await generateMp4(filePath, {
      durationSeconds: 20,
      width: 640,
      height: 360,
      megabitsPerSecond: 4,
    });
    fileSize = (await stat(filePath)).size;

    // The Worker runs in this process on the private queue prefix, so the
    // Compose video-worker (prefix `bull`) never sees these jobs.
    app = await createVideosTestApp('streamtube-test-e2e-flow', {
      videos: { uploadPartSizeBytes: PART_SIZE },
      withWorker: true,
      configure: (nestApp) => {
        nestApp.use(
          (
            req: {
              method: string;
              headers: Record<string, string | undefined>;
            },
            _res: unknown,
            next: () => void,
          ) => {
            apiRequests.push({
              method: req.method,
              contentType: req.headers['content-type'],
              contentLength: Number(req.headers['content-length'] ?? 0),
              chunked: req.headers['transfer-encoding'] === 'chunked',
            });
            next();
          },
        );
      },
    });
    dataSource = app.get(DataSource);
    storage = app.get(StorageService);
    queue = app.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
    throttlerStorage = app.get<ThrottlerStorageService>(ThrottlerStorage);
    await storage.ensureBucket();
  }, 120_000);

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await app.close();
    await rm(workDir, { recursive: true, force: true });
  }, 60_000);

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
    apiRequests.length = 0;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const initiate = async (): Promise<InitiateBody> => {
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set(auth(ownerToken))
      .send({
        filename: 'aula.mp4',
        size_bytes: fileSize,
        content_type: 'video/mp4',
      })
      .expect(201);
    return bodyOf<InitiateBody>(res);
  };

  /** Sends the file in parts straight to the storage URLs the API returned. */
  const sendFile = async (draft: InitiateBody): Promise<void> => {
    const file = await readFile(filePath);
    const partNumbers = Array.from(
      { length: draft.part_count },
      (_, index) => index + 1,
    );
    const res = await request(app.getHttpServer())
      .post(`/videos/${draft.id}/upload/part-urls`)
      .set(auth(ownerToken))
      .send({ part_numbers: partNumbers })
      .expect(200);
    for (const { part_number, url } of bodyOf<PartUrlsBody>(res).urls) {
      const start = (part_number - 1) * draft.part_size_bytes;
      const put = await fetch(url, {
        method: 'PUT',
        body: file.subarray(start, start + draft.part_size_bytes),
      });
      expect(put.ok).toBe(true);
    }
  };

  const getVideo = (id: string, token?: string) => {
    const req = request(app.getHttpServer()).get(`/videos/${id}`);
    if (token) req.set(auth(token));
    return req;
  };

  const waitUntilReady = async (id: string): Promise<VideoBody> => {
    // One request per second stays far below the videos throttle (120/min).
    const deadline = READY_TIMEOUT_MS / POLL_INTERVAL_MS;
    for (let attempt = 0; attempt < deadline; attempt++) {
      const body = bodyOf<VideoBody>(
        await getVideo(id, ownerToken).expect(200),
      );
      if (body.status === VideoStatus.READY) return body;
      if (body.status === VideoStatus.FAILED) {
        throw new Error(`Video failed: ${body.failure_reason}`);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error(`Video ${id} was not ready after ${READY_TIMEOUT_MS} ms`);
  };

  it('uploads straight to storage, processes in the worker and serves stream, download and thumbnail', async () => {
    const draft = await initiate();
    expect(draft.part_count).toBeGreaterThanOrEqual(2);
    await sendFile(draft);

    const completed = await request(app.getHttpServer())
      .post(`/videos/${draft.id}/upload/complete`)
      .set(auth(ownerToken))
      .expect(202);
    expect(bodyOf(completed)).toEqual({ id: draft.id, status: 'processing' });

    throttlerStorage.storage.clear();
    const video = await waitUntilReady(draft.id);
    expect(video.video_codec).toBe('h264');
    expect(video.width).toBe(640);
    expect(video.duration_seconds).toBeGreaterThan(19);
    expect(video.size_bytes).toBe(fileSize);

    // An anonymous visitor reads the ready video.
    await getVideo(draft.id).expect(200);

    // Stream: storage answers Range with 206.
    const stream = bodyOf<UrlBody>(
      await request(app.getHttpServer())
        .get(`/videos/${draft.id}/stream`)
        .expect(200),
    );
    const ranged = await fetch(stream.url, {
      headers: { Range: 'bytes=0-99' },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe(`bytes 0-99/${fileSize}`);
    expect((await ranged.arrayBuffer()).byteLength).toBe(100);

    // Download: attachment with the original name.
    const download = bodyOf<UrlBody>(
      await request(app.getHttpServer())
        .get(`/videos/${draft.id}/download`)
        .expect(200),
    );
    expect(download.filename).toBe('aula.mp4');
    const file = await fetch(download.url, { headers: { Range: 'bytes=0-9' } });
    expect(file.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(file.headers.get('content-disposition')).toContain('aula.mp4');
    await file.arrayBuffer();

    // Thumbnail: JPEG signature.
    const thumbnail = bodyOf<UrlBody>(
      await request(app.getHttpServer())
        .get(`/videos/${draft.id}/thumbnail`)
        .expect(200),
    );
    const image = new Uint8Array(
      await (await fetch(thumbnail.url)).arrayBuffer(),
    );
    expect(Array.from(image.slice(0, 3))).toEqual([0xff, 0xd8, 0xff]);

    // The file never went through the API: every request it received is small
    // JSON (or has no body), and none was chunked.
    expect(apiRequests.length).toBeGreaterThan(0);
    for (const recorded of apiRequests) {
      expect(recorded.chunked).toBe(false);
      expect(recorded.contentLength).toBeLessThan(MAX_API_REQUEST_BYTES);
      if (recorded.contentLength > 0) {
        expect(recorded.contentType).toContain('application/json');
      }
    }
  }, 180_000);

  it('hides a video that is not ready from another user and from an anonymous visitor', async () => {
    // A second draft that is never completed: it cannot become ready under the
    // in-process Worker, so the 404 does not race with processing.
    const draft = await initiate();

    const asOther = await getVideo(draft.id, otherToken).expect(404);
    const asAnonymous = await getVideo(draft.id).expect(404);
    expect(bodyOf(asOther)).toMatchObject({ error: 'VIDEO_NOT_FOUND' });
    expect(bodyOf(asAnonymous)).toMatchObject({ error: 'VIDEO_NOT_FOUND' });
    await getVideo(draft.id, ownerToken).expect(200);
  }, 60_000);
});
