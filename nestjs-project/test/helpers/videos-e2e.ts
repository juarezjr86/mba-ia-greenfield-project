import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { AuthService } from '../../src/auth/auth.service';
import { DomainExceptionFilter } from '../../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../../src/common/filters/validation-exception.filter';
import queueConfig from '../../src/config/queue.config';
import storageConfig from '../../src/config/storage.config';
import videosConfig from '../../src/config/videos.config';
import { MailService } from '../../src/mail/mail.service';

/** Typed access to a supertest response body (it is `any`). */
export function bodyOf<T = Record<string, unknown>>(res: { body: unknown }): T {
  return res.body as T;
}

export interface VideosTestAppOptions {
  /** Replaces fields of `videosConfig` (e.g. a small upload part size). */
  videos?: Partial<ConfigType<typeof videosConfig>>;
}

/**
 * Bootstraps `AppModule` the way `main.ts` does (global pipe and filters) with
 * the storage bucket replaced by a test bucket, so e2e runs never write to the
 * development bucket, and with a private queue prefix, so no job of the test is
 * ever seen by the Compose `video-worker`. The caller creates the bucket with
 * `ensureBucket()`.
 */
export async function createVideosTestApp(
  bucket: string,
  options: VideosTestAppOptions = {},
): Promise<INestApplication<App>> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(storageConfig.KEY)
    .useValue({
      ...storageConfig(),
      bucket,
      publicEndpoint: 'http://storage:9000',
    })
    .overrideProvider(queueConfig.KEY)
    .useValue({ ...queueConfig(), prefix: `test-${randomUUID()}` })
    .overrideProvider(videosConfig.KEY)
    .useValue({ ...videosConfig(), ...options.videos })
    .compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(
    new DomainExceptionFilter(),
    new ValidationExceptionFilter(),
  );
  await app.init();
  return app;
}

/**
 * Creates a confirmed user (and its channel) through the Phase 02 endpoints and
 * returns its access token. The confirmation e-mail is intercepted, not sent.
 */
export async function registerConfirmedUser(
  app: INestApplication<App>,
  email: string,
  password = 'password123',
): Promise<{ accessToken: string }> {
  let confirmationToken = '';
  const authService = app.get<AuthService>(AuthService);
  const mailService = (authService as unknown as { mailService: MailService })
    .mailService;
  jest
    .spyOn(mailService, 'sendConfirmationEmail')
    .mockImplementationOnce((_email: string, _name: string, token: string) => {
      confirmationToken = token;
      return Promise.resolve();
    });

  await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  await request(app.getHttpServer())
    .get('/auth/confirm-email')
    .query({ token: confirmationToken })
    .expect(204);
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(200);

  return { accessToken: bodyOf<{ access_token: string }>(login).access_token };
}
