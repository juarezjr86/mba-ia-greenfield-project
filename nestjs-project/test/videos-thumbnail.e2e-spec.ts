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

// JPEG signature (FF D8 FF) followed by filler.
const JPEG = Uint8Array.from([
  0xff,
  0xd8,
  0xff,
  0xe0,
  ...Array.from({ length: 60 }, (_, i) => i),
]);

interface ThumbnailBody {
  url: string;
  expires_in: number;
}

describe('GET /videos/:id/thumbnail (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let jwtService: JwtService;
  let storage: StorageService;
  let throttlerStorage: ThrottlerStorageService;
  let ownerToken: string;
  let otherToken: string;
  let readyId: string;
  let readyWithoutThumbnailId: string;
  let processingId: string;

  beforeAll(async () => {
    app = await createVideosTestApp('streamtube-test-e2e-thumbnail');
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
      withThumbnail: boolean,
    ): Promise<string> => {
      const id = randomUUID();
      const thumbnailKey = `videos/${id}/thumbnail.jpg`;
      await videos.save(
        videos.create({
          id,
          channel_id: channel.id,
          title: `Video ${status}`,
          original_filename: 'aula.mp4',
          content_type: 'video/mp4',
          size_bytes: 1000,
          status,
          storage_key: `videos/${id}/original.mp4`,
          thumbnail_key: withThumbnail ? thumbnailKey : null,
        }),
      );
      if (withThumbnail) {
        await storage.putObject(thumbnailKey, JPEG, 'image/jpeg');
      }
      return id;
    };

    readyId = await insert(VideoStatus.READY, true);
    readyWithoutThumbnailId = await insert(VideoStatus.READY, false);
    processingId = await insert(VideoStatus.PROCESSING, true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const getThumbnail = (id: string, authorization?: string) => {
    const req = request(app.getHttpServer()).get(`/videos/${id}/thumbnail`);
    if (authorization !== undefined) req.set('Authorization', authorization);
    return req;
  };

  it('ready-video-returns-a-jpeg-url', async () => {
    const res = await getThumbnail(readyId).expect(200);

    const body = bodyOf<ThumbnailBody>(res);
    expect(Object.keys(body).sort()).toEqual(['expires_in', 'url']);
    expect(body.expires_in).toBe(900);
    // Straight to storage, with no Authorization header.
    const file = await fetch(body.url);
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(file.status).toBe(200);
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xff, 0xd8, 0xff]);
    expect(bytes).toEqual(JPEG);
  });

  it('missing-thumbnail-is-a-conflict', async () => {
    const res = await getThumbnail(
      readyWithoutThumbnailId,
      `Bearer ${ownerToken}`,
    ).expect(409);

    expect(bodyOf(res)).toMatchObject({ error: 'THUMBNAIL_NOT_AVAILABLE' });
  });

  it('owner-reads-the-thumbnail-of-a-processing-video', async () => {
    await getThumbnail(processingId, `Bearer ${ownerToken}`).expect(200);
  });

  it('non-ready-video-is-hidden-from-others', async () => {
    const asOther = await getThumbnail(
      processingId,
      `Bearer ${otherToken}`,
    ).expect(404);
    const asAnonymous = await getThumbnail(processingId).expect(404);

    expect(bodyOf(asOther)).toMatchObject({ error: 'VIDEO_NOT_FOUND' });
    expect(bodyOf(asAnonymous)).toMatchObject({ error: 'VIDEO_NOT_FOUND' });
  });

  it('another-user-reads-the-thumbnail-of-a-ready-video', async () => {
    await getThumbnail(readyId, `Bearer ${otherToken}`).expect(200);
  });

  it('invalid-token-is-unauthorized', async () => {
    await getThumbnail(readyId, 'Bearer not-a-token').expect(401);
  });

  it('non-uuid-id-is-a-validation-error', async () => {
    const res = await getThumbnail('not-a-uuid').expect(400);

    expect(bodyOf(res)).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('unknown-id-is-not-found', async () => {
    const res = await getThumbnail(randomUUID()).expect(404);

    expect(bodyOf(res)).toMatchObject({ error: 'VIDEO_NOT_FOUND' });
  });
});
