import { envValidationSchema } from './env.validation';

const requiredEnv = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  S3_ACCESS_KEY: 's3-access',
  S3_SECRET_KEY: 's3-secret',
};

const validate = (env: Record<string, string>) =>
  envValidationSchema.validate(
    { ...requiredEnv, ...env },
    { allowUnknown: true, abortEarly: false },
  );

describe('envValidationSchema — SWAGGER_ENABLED', () => {
  it('should reject SWAGGER_ENABLED with an invalid value', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'invalid' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('SWAGGER_ENABLED');
  });

  it('should accept SWAGGER_ENABLED=true', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'true' });
    expect(error).toBeUndefined();
  });

  it('should accept SWAGGER_ENABLED=false', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'false' });
    expect(error).toBeUndefined();
  });

  it('should apply default false when SWAGGER_ENABLED is not set', () => {
    const result = validate({});
    const value = result.value as Record<string, string>;
    expect(result.error).toBeUndefined();
    expect(value.SWAGGER_ENABLED).toBe('false');
  });
});

describe('envValidationSchema — storage, queue and videos', () => {
  const valueOf = (env: Record<string, string> = {}) =>
    validate(env).value as Record<string, unknown>;

  it.each(['S3_ACCESS_KEY', 'S3_SECRET_KEY'])(
    'should fail when %s is missing',
    (key) => {
      const env: Record<string, string> = { ...requiredEnv };
      delete env[key];

      const { error } = envValidationSchema.validate(env, {
        allowUnknown: true,
        abortEarly: false,
      });

      expect(error).toBeDefined();
      expect(error!.message).toContain(key);
    },
  );

  it('should apply the Compose-network defaults', () => {
    const value = valueOf();

    expect(value).toMatchObject({
      S3_ENDPOINT: 'http://storage:9000',
      S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'streamtube',
      S3_CORS_ALLOWED_ORIGINS: '*',
      REDIS_HOST: 'redis',
      REDIS_PORT: 6379,
      QUEUE_PREFIX: 'bull',
      VIDEO_JOB_ATTEMPTS: 3,
      VIDEO_JOB_BACKOFF_MS: 30000,
      UPLOAD_PART_SIZE_BYTES: 67108864,
      UPLOAD_MAX_SIZE_BYTES: 10737418240,
      PART_URLS_MAX_BATCH: 100,
      PRESIGN_PART_EXPIRES_SECONDS: 3600,
      PRESIGN_GET_EXPIRES_SECONDS: 900,
      VIDEOS_THROTTLE_LIMIT: 120,
      VIDEOS_THROTTLE_TTL_MS: 60000,
      MEDIA_TOOL_TIMEOUT_MS: 600000,
    });
  });

  it.each(['1048576', '5242879', '3000000000', '2147483648'])(
    'should reject UPLOAD_PART_SIZE_BYTES=%s',
    (size) => {
      const { error } = validate({ UPLOAD_PART_SIZE_BYTES: size });

      expect(error).toBeDefined();
      expect(error!.message).toContain('UPLOAD_PART_SIZE_BYTES');
    },
  );

  it.each(['5242880', '2147483647'])(
    'should accept UPLOAD_PART_SIZE_BYTES=%s',
    (size) => {
      const { error } = validate({ UPLOAD_PART_SIZE_BYTES: size });

      expect(error).toBeUndefined();
    },
  );

  it('should reject a non-URL S3_ENDPOINT', () => {
    const { error } = validate({ S3_ENDPOINT: 'not a url' });

    expect(error).toBeDefined();
    expect(error!.message).toContain('S3_ENDPOINT');
  });
});
