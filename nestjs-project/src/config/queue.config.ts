import { registerAs } from '@nestjs/config';

export default registerAs('queue', () => ({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  prefix: process.env.QUEUE_PREFIX || 'bull',
  videoJobAttempts: parseInt(process.env.VIDEO_JOB_ATTEMPTS || '3', 10),
  videoJobBackoffMs: parseInt(process.env.VIDEO_JOB_BACKOFF_MS || '30000', 10),
}));
