# CLAUDE.md

## Environment Startup Verification

**Default behavior:** starting the environment means starting **only infrastructure services** (database, mail, etc.) — **never** start the NestJS application server unless the user explicitly asks to run/serve the project (e.g., "rode o projeto", "suba o servidor", "run the app").

After starting infrastructure, always confirm the containers are up before proceeding:

```bash
docker compose ps   # all services must show status "running"
```

Then verify each infrastructure service is actually ready to accept connections — not just running:

- **PostgreSQL:** `docker compose exec db pg_isready -U streamtube` — expect `accepting connections`

Only start the NestJS dev server (`npm run start:dev`) when the user **explicitly** asks to run the application — never as part of "start the environment".

## Development Environment

This project runs inside Docker. Always use the container for development:

```bash
# Start containers
docker compose up -d

# Install dependencies (first time only)
docker compose exec nestjs-api npm install

# Run the dev server (watch mode)
docker compose exec nestjs-api npm run start:dev
```

Services:
- `nestjs-api` — NestJS API, port `3000`
- `db` — PostgreSQL 17, port `5432`, database `streamtube`, user/password `streamtube`
- `mailpit` — SMTP `1025`, web UI `8025`
- `storage` — S3-compatible object storage, image `pgsty/silo:RELEASE.2026-10-18T00-00-00Z` (replaces MinIO, whose official image is no longer distributed; the tag is pinned, never `latest`), S3 on `9000`, console on `9001`, volume `storage_data`
- `redis` — Redis 7.4.11 with `--maxmemory-policy noeviction` (BullMQ requires it), healthcheck `redis-cli ping`
- `video-worker` — the queue consumer: same image and bind mount as `nestjs-api`, entrypoint `src/worker.ts`, no published port, `stop_grace_period: 60s`. Its command is the exec form of `npm run start:worker` on purpose (under `npm run` the `SIGTERM` of `docker compose stop` ended the process before the shutdown hooks ran)

`ffmpeg` and `ffprobe` are installed by `Dockerfile.dev`. After `docker compose up -d`, create the bucket once with `docker compose exec nestjs-api npm run storage:init` (nothing creates it at application start).

All verification and teardown commands run on the **host machine**:

```bash
# Verify NestJS is running (expect 200 + "Hello World!")
curl http://localhost:3000

# Verify PostgreSQL is ready (runs inside the db container)
docker compose exec db pg_isready -U streamtube

# Check container logs
docker compose logs nestjs-api
docker compose logs db

# Tear down the entire environment
docker compose down
```

## Commands

**Strict rule:** every `npm`, `npx`, `node`, `tsc`, and test command runs **inside the container**, never on the host. Running on the host causes env-var divergence (`DB_HOST` resolves to `localhost` instead of the Compose service), uses a different Node version, and produces results that do not reflect what runs in CI/prod.

### Container-only commands (always prefix with `docker compose exec nestjs-api`)

```bash
npm run start:dev                        # Dev server with hot-reload
npm run build                            # Compile to dist/
npm run start:prod                       # Run compiled build

npm test                                 # Unit tests
npm run test:watch                       # Unit tests in watch mode
npm run test:cov                         # Coverage report
npm run test:e2e                         # End-to-end tests (always with --runInBand)

npx tsc --noEmit                         # Type-check (required before declaring a task done)
npm run lint                             # ESLint with auto-fix
npm run format                           # Prettier formatting
```

### Host-only commands (Docker / connectivity probes)

```bash
docker compose ps
docker compose logs nestjs-api
docker compose exec db pg_isready -U streamtube
curl http://localhost:3000
```

### Test execution

Integration and e2e suites share a single test database. They **must** be run with `--runInBand`:

```bash
docker compose exec nestjs-api npm test -- --runInBand
docker compose exec nestjs-api npm run test:e2e   # already configured
```

Parallel execution causes FK violations, deadlocks, and cross-suite contamination because suites truncate or seed shared tables concurrently.

During active development, run only the tests related to the file being changed (`npm test -- path/to/file.spec.ts`). Before declaring a task done, run the full suite — see the global `CLAUDE.md` → "Definition of Done (Technical)".

## Long-running Processes

Commands that never exit (dev server, watch modes) must be run in background in the Bash tool — otherwise the agent blocks indefinitely waiting for the process to return.

This applies to: `start:dev`, `start:prod`, `test:watch`, and any other persistent process.

## Test Type Selection

Choose the suffix by what the test really does, not by where the code under test lives. The suffix is a contract that drives Jest config (`testRegex`, parallelism), CI steps, and reader expectations.

| Suffix                  | Purpose                                                              | DB / external I/O | Location                     |
|-------------------------|----------------------------------------------------------------------|-------------------|------------------------------|
| `*.spec.ts`             | **Unit** — pure logic, all collaborators mocked                      | Forbidden         | Next to the source file      |
| `*.integration-spec.ts` | **Integration** — exercises real DB, real repositories, real modules | Required          | Next to the source file      |
| `*.e2e-spec.ts`         | **End-to-end** — full HTTP cycle via `supertest`                     | Required          | `nestjs-project/test/`       |

A test that constructs a `TypeOrmModule.forRoot`, opens a connection, or hits the `db` service **must** be `*.integration-spec.ts`, never `*.spec.ts`. A test that boots the full Nest application and makes HTTP calls **must** be `*.e2e-spec.ts`.

Conventions for **how to write** each kind of test (mocking patterns, AAA structure, override strategies for global guards, etc.) live in `.claude/rules/nestjs-testing.md` and load when you edit a test file.

## Jest Configuration

These settings are required in `package.json` (jest config) and `test/jest-e2e.json` for the project's tests to work correctly:

- `setupFiles: ["dotenv/config"]` — without this, `.env` is not loaded inside the Jest process. `DB_HOST`, `JWT_SECRET`, etc. fall back to undefined or to the host's `localhost`, breaking container-to-container DNS.
- `testRegex: '.*\\.(spec|integration-spec)\\.ts$'` — covers both unit (`*.spec.ts`) and integration (`*.integration-spec.ts`) suffixes.

Do not add new test-file suffixes; if a new test type is needed, update the regex deliberately.

## Environment File Conventions

`.env` is parsed by both Docker Compose and `dotenv` — values containing shell-special characters (`<`, `>`, `|`, `&`, spaces) **must be quoted** or rewritten:

```dotenv
# Wrong — the unquoted angle brackets are shell redirection syntax and break parsing
MAIL_FROM=StreamTube <noreply@streamtube.local>

# Right — quote the value
MAIL_FROM="StreamTube <noreply@streamtube.local>"
```

Whenever possible, prefer storing only the bare address in `.env` and composing display names in code (e.g., in `mail.config.ts`) so the file stays shell-safe.

## Build Assets

`tsc` (and therefore `nest build`) only emits compiled `.ts` files to `dist/`. Any non-TypeScript runtime asset — Handlebars templates (`.hbs`), JSON fixtures, static config files, etc. — must be declared in `nest-cli.json` under `compilerOptions.assets` (with `watchAssets: true` for dev). Without that, the file exists in `src/` but is missing in `dist/` and runtime fails only after build.

## Videos, Queue and Worker (Phase 03)

### Modules (`src/`)

| Module | Role |
|---|---|
| `videos/` | `VideosController` (8 routes), `VideosService`, `Video` entity (`draft`, `processing`, `ready`, `failed`), response DTOs, `upload-plan.util.ts`, `video-naming.util.ts` |
| `storage/` | `StorageService` over two AWS SDK v3 S3 clients (`internal` for the API and worker, `public` for URLs handed to users): multipart, presigned PUT/GET, `headObject`, `putObject`, `ensureBucket`; `storage-bootstrap.ts` is the `storage:init` script |
| `queue/` | `QueueModule` and `VideoQueueProducer`: queue `video-processing`, job `process-video` (`{ videoId }`, job id = video id, so a repeated enqueue is one job) |
| `media/` | `MediaToolsService`: `ffprobe` and `ffmpeg` through `spawn` over a presigned GET URL, timeout `MEDIA_TOOL_TIMEOUT_MS` |
| `worker/` | `VideoProcessor` (the `@Processor`), `VideoProcessingService`, `VideoProcessingModule`, `WorkerModule`; `src/worker.ts` is the process entrypoint. The API never runs a Worker: `AppModule` does not import `VideoProcessingModule` |
| `config/` | namespaces `storage.config.ts`, `queue.config.ts`, `videos.config.ts`, validated in `env.validation.ts`; `root-modules.ts` shares the root config and database between `AppModule` and `WorkerModule` |

Migration: `src/database/migrations/1792365226864-CreateVideos.ts`. Domain errors are in `src/common/exceptions/domain.exception.ts`.

### Endpoints (`VideosController`, `@Controller('videos')`)

| Method and path | Auth | Success |
|---|---|---|
| `POST /videos` | owner | `201`, draft + upload plan (`part_size_bytes`, `part_count`) |
| `POST /videos/:id/upload/part-urls` | owner | `200`, presigned PUT URLs (`part_numbers`, up to `PART_URLS_MAX_BATCH`) |
| `GET /videos/:id/upload/parts` | owner | `200`, parts already stored (to resume) |
| `POST /videos/:id/upload/complete` | owner | `202`, `processing`, job enqueued (idempotent) |
| `GET /videos/:id` | optional | `200`; the owner sees any status, others only `ready` |
| `GET /videos/:id/stream` | optional | `200` `{ url, expires_in }`; the URL answers `Range` with `206` |
| `GET /videos/:id/download` | optional | `200` `{ url, expires_in, filename }`; the URL answers `Content-Disposition: attachment` |
| `GET /videos/:id/thumbnail` | optional | `200` `{ url, expires_in }` (JPEG) |

"Optional" auth is `@Public()` + `@OptionalAuth()`: no token is anonymous, an invalid or expired token is `401`. A video the caller may not see is `404 VIDEO_NOT_FOUND` (a `draft` is never revealed); `409` codes: `VIDEO_NOT_IN_DRAFT`, `UPLOAD_INCOMPLETE`, `VIDEO_ALREADY_PROCESSED`, `VIDEO_FILE_NOT_AVAILABLE`, `THUMBNAIL_NOT_AVAILABLE`; `422 VIDEO_SIZE_MISMATCH`. `VideosController` has its own `@Throttle` (`VIDEOS_THROTTLE_LIMIT` per `VIDEOS_THROTTLE_TTL_MS`, read on each request from `process.env`), replacing the global limit.

### Commands

```bash
docker compose exec nestjs-api npm run storage:init       # create the bucket and its CORS (idempotent)
docker compose exec nestjs-api npm run start:worker       # worker by hand (the Compose video-worker already runs it)
docker compose exec nestjs-api npm run openapi:export     # rewrite openapi.json
```

`start:worker:prod` runs `node dist/worker`.

### Environment variables (defaults in `src/config/*.config.ts`; keys in `.env.example`)

| Variable | Default |
|---|---|
| `S3_ENDPOINT` | `http://storage:9000` |
| `S3_PUBLIC_ENDPOINT` | `http://localhost:9000` (see below) |
| `S3_REGION`, `S3_BUCKET` | `us-east-1`, `streamtube` |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | required, no default (Compose also uses them as the storage root credentials) |
| `S3_CORS_ALLOWED_ORIGINS` | `*` |
| `REDIS_HOST`, `REDIS_PORT` | `redis`, `6379` |
| `QUEUE_PREFIX` | `bull` |
| `VIDEO_JOB_ATTEMPTS`, `VIDEO_JOB_BACKOFF_MS` | `3`, `30000` (exponential) |
| `UPLOAD_PART_SIZE_BYTES` | `67108864` (Joi range 5242880..2147483647) |
| `UPLOAD_MAX_SIZE_BYTES` | `10737418240` |
| `PART_URLS_MAX_BATCH` | `100` |
| `PRESIGN_PART_EXPIRES_SECONDS`, `PRESIGN_GET_EXPIRES_SECONDS` | `3600`, `900` |
| `VIDEOS_THROTTLE_LIMIT`, `VIDEOS_THROTTLE_TTL_MS` | `120`, `60000` |
| `MEDIA_TOOL_TIMEOUT_MS` | `600000` |

**Exception to "never `localhost`":** `S3_PUBLIC_ENDPOINT` is the address of the client outside Docker; presigned URLs are signed for it. A URL signed for `localhost:9000` is unreachable from inside `nestjs-api`, so every test that fetches a presigned URL overrides it with `http://storage:9000` (`createVideosTestApp` and the integration specs do).

### Testing notes

- Suites that boot the queue use a private `QUEUE_PREFIX` and their own bucket (`streamtube-test-*`, created with `ensureBucket()`), so the running `video-worker` (prefix `bull`) never sees their jobs and they never write to the dev bucket. `test/helpers/videos-e2e.ts`: `createVideosTestApp(bucket, { videos, withWorker, configure })`, `registerConfirmedUser`.
- `withWorker: true` loads `VideoProcessingModule` (never `WorkerModule`, which would add a second root DataSource) so the Worker runs inside the test process.
- Any test that imports `VideoProcessingModule` needs a private `QUEUE_PREFIX` (the `@Processor` starts a Worker).
- `npm run test:e2e` must be run with `--runInBand`; Jest has to end on its own (no `--forceExit`).

### Known limits

- Accepted containers (`ACCEPTED_CONTAINERS` in `src/media/probe-mapper.ts`, from `ffprobe`'s `format_name`): MP4 and QuickTime (`mov,mp4,...`), Matroska and WebM (`matroska,webm`). Any other container (AVI, MPEG-TS, ...) ends the video `failed` with `Unsupported container format: <name>`. Only MP4/H.264 was exercised against the real tools (TD-07 spike and tests).

- A `failed` video whose object is missing still gets a stream URL that storage answers `404`; no `HeadObject` per request.
- Abandoned drafts and their multipart uploads are not cleaned up in this phase.
- `openapi.json` request DTOs have empty `properties`: the Swagger plugin does not run under the `ts-node` export script (response DTOs are complete).

## Architecture

NestJS with standard module structure. Source lives in `src/`, compiled output in `dist/`.

- Each domain feature gets its own module (e.g., `UsersModule`, `VideosModule`) registered in `AppModule`
- Controllers handle HTTP routing; Services hold business logic; both are scoped to their module

## Code Conventions

- **TypeScript:** `nodenext` module resolution, `ES2023` target, `strictNullChecks` on, `noImplicitAny` off
- **Decorators:** `emitDecoratorMetadata` + `experimentalDecorators` enabled — required for NestJS DI
- **Prettier:** single quotes, trailing commas everywhere
- **ESLint:** `no-explicit-any` allowed; `no-floating-promises` and `no-unsafe-argument` are warnings

## REST Conventions

This is a RESTful API. All endpoints must follow standard REST conventions — correct HTTP methods, proper status codes, plural resource nouns, and consistent URL structure. Details are enforced via rules on controller files.
