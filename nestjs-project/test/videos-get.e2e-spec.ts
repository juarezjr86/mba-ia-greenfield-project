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

// The 17 keys of the GET /videos/:id contract (API Contracts, SI-03.15).
const CONTRACT_KEYS = [
  'bitrate',
  'channel_id',
  'container_format',
  'content_type',
  'created_at',
  'duration_seconds',
  'failure_reason',
  'fps',
  'height',
  'id',
  'original_filename',
  'size_bytes',
  'status',
  'title',
  'updated_at',
  'video_codec',
  'width',
].sort();

describe('GET /videos/:id (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let jwtService: JwtService;
  let throttlerStorage: ThrottlerStorageService;
  let ownerToken: string;
  let otherToken: string;
  const videoIds = {} as Record<VideoStatus, string>;

  beforeAll(async () => {
    app = await createVideosTestApp('streamtube-test-e2e-get');
    dataSource = app.get(DataSource);
    jwtService = app.get(JwtService);
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

    const ownerId = jwtService.decode<{ sub: string }>(ownerToken).sub;
    const channel = await dataSource
      .getRepository(Channel)
      .findOneByOrFail({ user_id: ownerId });
    const videos = dataSource.getRepository(Video);
    for (const status of Object.values(VideoStatus)) {
      const id = randomUUID();
      await videos.save(
        videos.create({
          id,
          channel_id: channel.id,
          title: `Video ${status}`,
          original_filename: 'aula.mp4',
          content_type: 'video/mp4',
          size_bytes: 1048576,
          status,
          upload_id: 'internal-upload-id',
          part_size_bytes: 5242880,
          part_count: 1,
          storage_key: `videos/${id}/original.mp4`,
          thumbnail_key:
            status === VideoStatus.READY ? `videos/${id}/thumbnail.jpg` : null,
          ffprobe_metadata:
            status === VideoStatus.READY
              ? { format: { size: '1048576' } }
              : null,
          failure_reason:
            status === VideoStatus.FAILED ? 'Invalid data found' : null,
        }),
      );
      videoIds[status] = id;
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const getVideo = (id: string, authorization?: string) => {
    const req = request(app.getHttpServer()).get(`/videos/${id}`);
    if (authorization !== undefined) req.set('Authorization', authorization);
    return req;
  };

  it('ready-video-is-public-and-hides-internal-fields', async () => {
    const res = await getVideo(videoIds[VideoStatus.READY]).expect(200);

    const body = bodyOf<Record<string, unknown>>(res);
    expect(body).toMatchObject({
      id: videoIds[VideoStatus.READY],
      title: 'Video ready',
      status: VideoStatus.READY,
      size_bytes: 1048576,
      failure_reason: null,
    });
    // Allowlist: nothing outside the contract leaks (thumbnail_key,
    // part_count, ... included), not only the three named in the AC.
    expect(Object.keys(body).sort()).toEqual(CONTRACT_KEYS);
  });

  it('owner-reads-any-status-and-sees-failure-reason', async () => {
    for (const status of [
      VideoStatus.DRAFT,
      VideoStatus.PROCESSING,
      VideoStatus.FAILED,
    ]) {
      const res = await getVideo(
        videoIds[status],
        `Bearer ${ownerToken}`,
      ).expect(200);

      expect(bodyOf(res)).toMatchObject({
        status,
        failure_reason:
          status === VideoStatus.FAILED ? 'Invalid data found' : null,
      });
    }
  });

  it('ready-video-hides-failure-reason-from-other-user', async () => {
    const res = await getVideo(
      videoIds[VideoStatus.READY],
      `Bearer ${otherToken}`,
    ).expect(200);

    expect(bodyOf(res)).toMatchObject({ failure_reason: null });
  });

  it.each([VideoStatus.DRAFT, VideoStatus.PROCESSING, VideoStatus.FAILED])(
    'non-ready-%s-video-is-hidden-from-another-user-and-anonymous',
    async (status) => {
      const asOther = await getVideo(
        videoIds[status],
        `Bearer ${otherToken}`,
      ).expect(404);
      const asAnonymous = await getVideo(videoIds[status]).expect(404);

      expect(bodyOf(asOther)).toMatchObject({ error: 'VIDEO_NOT_FOUND' });
      expect(bodyOf(asAnonymous)).toMatchObject({ error: 'VIDEO_NOT_FOUND' });
    },
  );

  it('unknown-id-is-not-found', async () => {
    const res = await getVideo(randomUUID()).expect(404);

    expect(bodyOf(res)).toMatchObject({ error: 'VIDEO_NOT_FOUND' });
  });

  describe('a token that is present but unusable', () => {
    it.each([
      ['not a jwt', 'Bearer not-a-token'],
      ['a non-Bearer scheme', 'Basic dXNlcjpwYXNz'],
      ['an empty Bearer', 'Bearer '],
    ])('is unauthorized: %s', async (_label, header) => {
      await getVideo(videoIds[VideoStatus.READY], header).expect(401);
    });

    it('is unauthorized: expired access token', async () => {
      const ownerId = jwtService.decode<{ sub: string }>(ownerToken).sub;
      const expired = jwtService.sign(
        { sub: ownerId, email: 'owner@example.com' },
        { expiresIn: -60 },
      );

      await getVideo(videoIds[VideoStatus.READY], `Bearer ${expired}`).expect(
        401,
      );
    });
  });

  it('non-uuid-id-is-a-validation-error', async () => {
    const res = await getVideo('not-a-uuid').expect(400);

    expect(bodyOf(res)).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  describe('phase 02 routes keep their behavior', () => {
    it('public routes answer without a token', async () => {
      await request(app.getHttpServer()).get('/').expect(200);
    });

    it('public routes still ignore an invalid token', async () => {
      await request(app.getHttpServer())
        .get('/')
        .set('Authorization', 'Bearer not-a-token')
        .expect(200);
      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .set('Authorization', 'Bearer not-a-token')
        .send({ email: `nobody_${randomUUID()}@example.com` })
        .expect(204);
    });

    it('protected routes still require a token', async () => {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
    });
  });
});
