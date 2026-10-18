import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Video, VideoStatus } from './video.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];
const TEN_GIB = 10737418240;

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  async function createChannel(): Promise<Channel> {
    const user = await userRepository.save(
      userRepository.create({
        email: `video_owner_${randomUUID()}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: 'Owner',
        nickname: `owner_${randomUUID().slice(0, 8)}`,
        user_id: user.id,
      }),
    );
  }

  function buildVideo(channel: Channel, overrides: Partial<Video> = {}): Video {
    const id = randomUUID();
    return videoRepository.create({
      id,
      channel_id: channel.id,
      title: 'My video',
      original_filename: 'my-video.mp4',
      content_type: 'video/mp4',
      size_bytes: 1024,
      storage_key: `videos/${id}/original.mp4`,
      ...overrides,
    });
  }

  it('stores a video created without status as draft', async () => {
    const channel = await createChannel();

    const saved = await videoRepository.save(buildVideo(channel));
    const found = await videoRepository.findOneByOrFail({ id: saved.id });

    expect(found.status).toBe(VideoStatus.DRAFT);
  });

  it('keeps the processing fields null until the worker fills them', async () => {
    const channel = await createChannel();
    const saved = await videoRepository.save(buildVideo(channel));

    const found = await videoRepository.findOneByOrFail({ id: saved.id });

    expect(found).toMatchObject({
      upload_id: null,
      part_size_bytes: null,
      part_count: null,
      thumbnail_key: null,
      duration_seconds: null,
      container_format: null,
      video_codec: null,
      width: null,
      height: null,
      bitrate: null,
      fps: null,
      ffprobe_metadata: null,
      failure_reason: null,
    });
  });

  it('rejects a status outside the enum', async () => {
    const channel = await createChannel();
    const id = randomUUID();

    await expect(
      dataSource.query(
        `INSERT INTO "videos" ("id", "channel_id", "title", "original_filename", "content_type", "size_bytes", "status", "storage_key")
         VALUES ($1, $2, 't', 'f.mp4', 'video/mp4', 1, 'bogus', $3)`,
        [id, channel.id, `videos/${id}/original.mp4`],
      ),
    ).rejects.toThrow(/videos_status_enum/);
  });

  it('rejects a size_bytes of 0', async () => {
    const channel = await createChannel();

    await expect(
      videoRepository.save(buildVideo(channel, { size_bytes: 0 })),
    ).rejects.toThrow(/CHK_|check constraint/i);
  });

  it('rejects a video whose channel does not exist', async () => {
    const orphan = buildVideo({ id: randomUUID() } as Channel);

    await expect(videoRepository.save(orphan)).rejects.toThrow(/foreign key/i);
  });

  it('refuses to delete a channel that still has videos', async () => {
    const channel = await createChannel();
    await videoRepository.save(buildVideo(channel));

    await expect(
      dataSource.query(`DELETE FROM "channels" WHERE "id" = $1`, [channel.id]),
    ).rejects.toThrow(/foreign key/i);
  });

  it('reads bigint, numeric and jsonb columns back as numbers and objects', async () => {
    const channel = await createChannel();
    const metadata = { format: { duration: '1500.123' }, streams: [{ a: 1 }] };
    const saved = await videoRepository.save(
      buildVideo(channel, {
        size_bytes: TEN_GIB,
        bitrate: 11_000_000,
        duration_seconds: 1500.123,
        fps: 29.97,
        ffprobe_metadata: metadata,
      }),
    );

    const found = await videoRepository.findOneByOrFail({ id: saved.id });

    expect(found.size_bytes).toBe(TEN_GIB);
    expect(found.bitrate).toBe(11_000_000);
    expect(found.duration_seconds).toBe(1500.123);
    expect(found.fps).toBe(29.97);
    expect(found.ffprobe_metadata).toEqual(metadata);
  });

  it('loads the videos of a channel through the inverse relation', async () => {
    const channel = await createChannel();
    const saved = await videoRepository.save(buildVideo(channel));

    const found = await channelRepository.findOneOrFail({
      where: { id: channel.id },
      relations: ['videos'],
    });

    expect(found.videos.map((video) => video.id)).toEqual([saved.id]);
  });

  it('empties videos before channels in cleanAllTables without an FK error', async () => {
    const channel = await createChannel();
    await videoRepository.save(buildVideo(channel));

    await expect(cleanAllTables(dataSource)).resolves.toBeUndefined();

    await expect(videoRepository.count()).resolves.toBe(0);
  });
});
