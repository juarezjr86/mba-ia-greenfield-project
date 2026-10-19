import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import type { StorageService } from '../storage/storage.service';
import { User } from '../users/entities/user.entity';
import { Video, VideoStatus } from '../videos/entities/video.entity';

/**
 * Creates a user, its channel and a `processing` video whose uploaded file is
 * `body`, stored under the same key `VideosService` would have used. This is
 * the state the worker finds after `POST /videos/:id/upload/complete`.
 */
export async function createProcessingVideo(
  dataSource: DataSource,
  storage: StorageService,
  body: Buffer,
  overrides: Partial<Video> = {},
): Promise<Video> {
  const user = await dataSource.getRepository(User).save(
    dataSource.getRepository(User).create({
      email: `worker_${randomUUID()}@example.com`,
      password: 'hashed',
    }),
  );
  const channel = await dataSource.getRepository(Channel).save(
    dataSource.getRepository(Channel).create({
      name: 'Worker channel',
      nickname: `w_${randomUUID().slice(0, 12)}`,
      user_id: user.id,
    }),
  );

  const id = randomUUID();
  const storageKey = `videos/${id}/original.mp4`;
  await storage.putObject(storageKey, body, 'video/mp4');

  return dataSource.getRepository(Video).save(
    dataSource.getRepository(Video).create({
      id,
      channel_id: channel.id,
      title: 'aula',
      original_filename: 'aula.mp4',
      content_type: 'video/mp4',
      size_bytes: body.length,
      status: VideoStatus.PROCESSING,
      storage_key: storageKey,
      ...overrides,
    }),
  );
}
