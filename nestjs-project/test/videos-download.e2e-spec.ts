import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Channel } from '../src/channels/entities/channel.entity';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import {
  bodyOf,
  createVideosTestApp,
  registerConfirmedUser,
} from './helpers/videos-e2e';

const OBJECT_BYTES = Uint8Array.from({ length: 1000 }, (_, i) => (i % 251) + 1);
const ACCENTED_NAME = 'Vídeo ação.mp4';

interface DownloadBody {
  url: string;
  expires_in: number;
  filename: string;
}

describe('GET /videos/:id/download (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let jwtService: JwtService;
  let storage: StorageService;
  let throttlerStorage: ThrottlerStorageService;
  let ownerToken: string;
  let otherToken: string;
  let readyId: string;
  let accentedId: string;
  const videoIds = {} as Record<VideoStatus, string>;

  beforeAll(async () => {
    app = await createVideosTestApp('streamtube-test-e2e-download');
    dataSource = app.get(DataSource);
    jwtService = app.get(JwtService);
    storage = app.get(StorageService);
    throttlerStorage = app.get<ThrottlerStorageService>(ThrottlerStorage);
    await storage.ensureBucket();
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

    const ownerId = jwtService.decode<{ sub: string }>(ownerToken).sub;
    const channel = await dataSource
      .getRepository(Channel)
      .findOneByOrFail({ user_id: ownerId });
    const videos = dataSource.getRepository(Video);

    const insert = async (
      status: VideoStatus,
      originalFilename: string,
    ): Promise<string> => {
      const id = randomUUID();
      const storageKey = `videos/${id}/original.mp4`;
      await videos.save(
        videos.create({
          id,
          channel_id: channel.id,
          title: `Video ${status}`,
          original_filename: originalFilename,
          content_type: 'video/mp4',
          size_bytes: OBJECT_BYTES.length,
          status,
          storage_key: storageKey,
        }),
      );
      // A draft has no stored object yet.
      if (status !== VideoStatus.DRAFT) {
        await storage.putObject(storageKey, OBJECT_BYTES, 'video/mp4');
      }
      return id;
    };

    readyId = await insert(VideoStatus.READY, 'aula.mp4');
    accentedId = await insert(VideoStatus.READY, ACCENTED_NAME);
    videoIds[VideoStatus.PROCESSING] = await insert(
      VideoStatus.PROCESSING,
      'aula.mp4',
    );
    videoIds[VideoStatus.DRAFT] = await insert(VideoStatus.DRAFT, 'aula.mp4');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const getDownload = (id: string, authorization?: string) => {
    const req = request(app.getHttpServer()).get(`/videos/${id}/download`);
    if (authorization !== undefined) req.set('Authorization', authorization);
    return req;
  };

  it('ready-video-returns-url-and-filename', async () => {
    const res = await getDownload(readyId).expect(200);

    const body = bodyOf<DownloadBody>(res);
    expect(Object.keys(body).sort()).toEqual(['expires_in', 'filename', 'url']);
    expect(body.url).toEqual(expect.stringContaining('X-Amz-Signature'));
    expect(body.expires_in).toBe(900);
    expect(body.filename).toBe('aula.mp4');
  });

  it('url-answers-content-disposition-attachment', async () => {
    const res = await getDownload(readyId).expect(200);

    // Straight to storage, with no Authorization header.
    const file = await fetch(bodyOf<DownloadBody>(res).url);

    expect(file.status).toBe(200);
    const disposition = file.headers.get('content-disposition') ?? '';
    expect(disposition).toMatch(/^attachment;/);
    expect(disposition).toContain('aula.mp4');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(OBJECT_BYTES);
  });

  it('accented-filename-is-preserved', async () => {
    const res = await getDownload(accentedId).expect(200);

    const body = bodyOf<DownloadBody>(res);
    expect(body.filename).toBe(ACCENTED_NAME);
    const file = await fetch(body.url, { headers: { Range: 'bytes=0-9' } });
    const disposition = file.headers.get('content-disposition') ?? '';
    expect(disposition).toContain("filename*=UTF-8''");
    const encoded = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1];
    expect(encoded).toBeDefined();
    expect(decodeURIComponent(encoded as string)).toBe(ACCENTED_NAME);
    await file.arrayBuffer();
  });

  it('owner-gets-a-url-for-a-processing-video', async () => {
    await getDownload(
      videoIds[VideoStatus.PROCESSING],
      `Bearer ${ownerToken}`,
    ).expect(200);
  });

  it('owner-of-a-draft-gets-file-not-available', async () => {
    const res = await getDownload(
      videoIds[VideoStatus.DRAFT],
      `Bearer ${ownerToken}`,
    ).expect(409);

    expect(bodyOf(res)).toMatchObject({ error: 'VIDEO_FILE_NOT_AVAILABLE' });
  });

  it.each([VideoStatus.PROCESSING, VideoStatus.DRAFT])(
    'non-ready-%s-video-is-hidden-from-others-as-404',
    async (status) => {
      const asOther = await getDownload(
        videoIds[status],
        `Bearer ${otherToken}`,
      ).expect(404);
      const asAnonymous = await getDownload(videoIds[status]).expect(404);

      expect(bodyOf(asOther)).toMatchObject({ error: 'VIDEO_NOT_FOUND' });
      expect(bodyOf(asAnonymous)).toMatchObject({ error: 'VIDEO_NOT_FOUND' });
    },
  );

  it('another-user-downloads-a-ready-video', async () => {
    await getDownload(readyId, `Bearer ${otherToken}`).expect(200);
  });

  it('invalid-token-is-unauthorized', async () => {
    await getDownload(readyId, 'Bearer not-a-token').expect(401);
  });

  it('non-uuid-id-is-a-validation-error', async () => {
    const res = await getDownload('not-a-uuid').expect(400);

    expect(bodyOf(res)).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('unknown-id-is-not-found', async () => {
    const res = await getDownload(randomUUID()).expect(404);

    expect(bodyOf(res)).toMatchObject({ error: 'VIDEO_NOT_FOUND' });
  });
});
