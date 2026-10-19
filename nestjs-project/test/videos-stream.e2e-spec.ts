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

// A known, non-zero pattern: the Range check compares bytes, not just a count.
const OBJECT_BYTES = Uint8Array.from({ length: 1000 }, (_, i) => (i % 251) + 1);

interface StreamBody {
  url: string;
  expires_in: number;
}

describe('GET /videos/:id/stream (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let jwtService: JwtService;
  let storage: StorageService;
  let throttlerStorage: ThrottlerStorageService;
  let ownerToken: string;
  let otherToken: string;
  const videoIds = {} as Record<VideoStatus, string>;

  beforeAll(async () => {
    app = await createVideosTestApp('streamtube-test-e2e-stream');
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
    for (const status of [
      VideoStatus.READY,
      VideoStatus.PROCESSING,
      VideoStatus.DRAFT,
    ]) {
      const id = randomUUID();
      const storageKey = `videos/${id}/original.mp4`;
      await videos.save(
        videos.create({
          id,
          channel_id: channel.id,
          title: `Video ${status}`,
          original_filename: 'aula.mp4',
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
      videoIds[status] = id;
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const getStream = (id: string, authorization?: string) => {
    const req = request(app.getHttpServer()).get(`/videos/${id}/stream`);
    if (authorization !== undefined) req.set('Authorization', authorization);
    return req;
  };

  it('ready-video-returns-presigned-url', async () => {
    const res = await getStream(videoIds[VideoStatus.READY]).expect(200);

    const body = bodyOf<StreamBody>(res);
    expect(Object.keys(body).sort()).toEqual(['expires_in', 'url']);
    expect(body.url).toEqual(expect.stringContaining('X-Amz-Signature'));
    expect(body.expires_in).toBe(900);
  });

  it('returned-url-answers-range-requests-with-206', async () => {
    const res = await getStream(videoIds[VideoStatus.READY]).expect(200);

    // Straight to storage, with no Authorization header.
    const ranged = await fetch(bodyOf<StreamBody>(res).url, {
      headers: { Range: 'bytes=0-99' },
    });

    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe('bytes 0-99/1000');
    expect(new Uint8Array(await ranged.arrayBuffer())).toEqual(
      OBJECT_BYTES.slice(0, 100),
    );
  });

  it('owner-gets-a-url-for-a-processing-video', async () => {
    await getStream(
      videoIds[VideoStatus.PROCESSING],
      `Bearer ${ownerToken}`,
    ).expect(200);
  });

  it('owner-of-a-draft-gets-file-not-available', async () => {
    const res = await getStream(
      videoIds[VideoStatus.DRAFT],
      `Bearer ${ownerToken}`,
    ).expect(409);

    expect(bodyOf(res)).toMatchObject({ error: 'VIDEO_FILE_NOT_AVAILABLE' });
  });

  it.each([VideoStatus.PROCESSING, VideoStatus.DRAFT])(
    'non-ready-%s-video-is-hidden-from-others-as-404',
    async (status) => {
      const asOther = await getStream(
        videoIds[status],
        `Bearer ${otherToken}`,
      ).expect(404);
      const asAnonymous = await getStream(videoIds[status]).expect(404);

      expect(bodyOf(asOther)).toMatchObject({ error: 'VIDEO_NOT_FOUND' });
      expect(bodyOf(asAnonymous)).toMatchObject({ error: 'VIDEO_NOT_FOUND' });
    },
  );

  it('another-user-streams-a-ready-video', async () => {
    await getStream(videoIds[VideoStatus.READY], `Bearer ${otherToken}`).expect(
      200,
    );
  });

  it('invalid-token-is-unauthorized', async () => {
    await getStream(videoIds[VideoStatus.READY], 'Bearer not-a-token').expect(
      401,
    );
  });

  it('non-uuid-id-is-a-validation-error', async () => {
    const res = await getStream('not-a-uuid').expect(400);

    expect(bodyOf(res)).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('unknown-id-is-not-found', async () => {
    const res = await getStream(randomUUID()).expect(404);

    expect(bodyOf(res)).toMatchObject({ error: 'VIDEO_NOT_FOUND' });
  });
});
