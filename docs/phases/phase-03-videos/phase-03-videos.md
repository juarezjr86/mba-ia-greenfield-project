---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-10T23:10:06-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-10-10T23:11:00-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-10T23:08:51-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Deliver large-file video upload (up to 10GB) straight from the client to S3-compatible storage with no file bytes crossing the API, a BullMQ queue and a separate worker that extract duration and metadata and generate a thumbnail with ffprobe/ffmpeg, a unique URL per video (`/videos/{id}`), and streaming and download of the stored file through short-lived presigned URLs.

---

## Step Implementations

### SI-03.1 — Make the migrations integration spec repeatable

**Description:** Fix the Phase 02 debt that makes `migrations.integration-spec.ts` fail on a second run (it never drops the enum types the migrations create), so every later SI can rely on a repeatable suite. Baseline repair required by the `phase-03-videos/TD-12` Revision (DG-1), done on this branch in dedicated commits before any new code. The Revision calls it "SI-03.0"; it is split into SI-03.1 and SI-03.2 here (the `.0.k` slot is reserved for UI bootstrap SIs).

**Technical actions:**

1. Add a helper to `src/test/create-test-data-source.ts` that drops every enum type in the `public` schema (`DROP TYPE ... CASCADE` for each row of `pg_type` with `typtype = 'e'` in that schema), so enums added by later migrations (`videos_status_enum`) are covered without editing the helper again
2. Update `src/database/migrations.integration-spec.ts` — call the helper in `beforeAll` after dropping the managed tables and the `migrations` table, so the spec starts from a clean schema on every run
3. Run `docker compose exec nestjs-api npm test -- --runInBand` twice in a row on the same database and record both results in `progress.md`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Migration runner (`CreateUsersAndChannels`, `CreateAuthTokens`) | Integration: apply, revert, apply again on a schema that already held the enum types | `src/database/migrations.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Two consecutive runs of the full suite on the same database both finish green, and neither hangs (the second run no longer fails on `verification_tokens_type_enum`)
- After the migrations spec finishes, the database is left fully migrated, as before
- The helper removes an enum type that was created by a migration the spec did not list by name

---

### SI-03.2 — Repair the Phase 02 lint baseline

**Description:** Bring `npm run lint` from 150 errors (40 warnings, none auto-fixable, 6 errors in `src/channels/channels.service.ts`) to zero errors, with no behavior change, so the Definition of Done can be met by every later SI. Baseline repair required by the `phase-03-videos/TD-12` Revision (DG-1).

**Technical actions:**

1. Run `docker compose exec nestjs-api npx eslint "{src,test}/**/*.ts"` (without `--fix`), save the list grouped by rule in `progress.md`, and record the passing test count of `npm test -- --runInBand` as the regression baseline
2. Fix the errors group by group, starting with `src/channels/channels.service.ts`, replacing `any` and unsafe access with typed code (for example a typed shape for the Postgres error in `isPgUniqueViolationOnColumn`). Do not add `eslint-disable` comments and do not relax rules in `eslint.config.mjs`; if a group cannot be fixed without changing behavior, stop and report it instead of silencing it
3. After each group, run the affected specs; at the end run `npm run lint`, `npx tsc --noEmit` and `npm test -- --runInBand`

**Tests:**

_(empty — behavior-preserving repair; the existing Phase 02 suite is the regression oracle)_

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `npm run lint` exits with code 0
- `npx tsc --noEmit` exits with code 0
- The full suite passes with the same number of tests as the baseline recorded before the repair
- `eslint.config.mjs` has no relaxed rule and no source file gained an `eslint-disable` comment

---

### SI-03.3 — Compose services for storage and queue, ffmpeg in the image

**Description:** Add the real S3-compatible storage and the Redis queue backend to Compose, and install ffmpeg in the single shared dev image, so every later SI runs against real services (`phase-03-videos/TD-03`, `TD-01`, `TD-06`, `TD-12`).

**Technical actions:**

1. Edit `nestjs-project/Dockerfile.dev` — add `ffmpeg` (which ships `ffprobe`) to the existing `apt install` line (per `phase-03-videos/TD-06`, Option C: one image for API and worker)
2. Resolve a concrete `pgsty/silo` tag with `docker manifest inspect` (never `latest`; if no stable tag resolves, stop and report) and add service `storage` to `nestjs-project/compose.yaml`: `command: server /data --console-address ":9001"`, ports `9000:9000` and `9001:9001`, a named volume on `/data`, root credentials through the `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` variables the fork keeps, set to `${S3_ACCESS_KEY}` / `${S3_SECRET_KEY}` from the same environment file so the credentials are defined once, and a comment recording the MinIO → `pgsty/silo` substitution with the pinned tag (per `phase-03-videos/TD-03` Revision)
3. Add service `redis` with a pinned image tag and `command: ["redis-server", "--maxmemory-policy", "noeviction"]` (BullMQ requirement, per `phase-03-videos/TD-01`)
4. Add `storage` and `redis` to the `depends_on` of `nestjs-api`; the versioned `compose.yaml` must work on its own, without the local `compose.override.yaml`
5. Rebuild the image and confirm the services come up

**Tests:**

_(empty — Infra)_

**Dependencies:** SI-03.2

**Acceptance criteria:**

- `docker compose up -d storage redis` leaves both services running
- `docker compose exec nestjs-api ffprobe -version` and `docker compose exec nestjs-api ffmpeg -version` exit with code 0
- `docker compose exec redis redis-cli CONFIG GET maxmemory-policy` returns `noeviction`
- From inside `nestjs-api`, `curl http://storage:9000` returns an HTTP response (any status), not a connection error
- `compose.yaml` shows the pinned image tag and a comment naming the MinIO substitution

---

### SI-03.4 — Dependencies, configuration namespaces and env validation

**Description:** Install the four libraries decided in `phase-03-videos/TD-01` and `TD-04`, and add the `storage`, `queue` and `videos` config namespaces with Joi validation, following the Phase 01 pattern (`registerAs` + `ConfigType`). Every new env key is defined once here and reused by Compose, `.env.example` and the Joi schema.

**Technical actions:**

1. Install in `nestjs-project`: `bullmq`, `@nestjs/bullmq`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` (versions in `library-refs.md`; re-check Context7 against the installed version). `@aws-sdk/lib-storage` is **not** installed: dropped by the student on 2026-10-18 because no capability uses `Upload`. The `TD-04` Libraries line still lists it, but the 2026-10-18 Revision of `phase-03-videos/TD-04` records the drop and supersedes that line
2. Create `src/config/storage.config.ts` — `registerAs('storage', ...)` reading `S3_ENDPOINT` (internal, default `http://storage:9000`), `S3_PUBLIC_ENDPOINT` (client-facing, default `http://localhost:9000`, the only place a host address is accepted, per `phase-03-videos/TD-04` Revision), `S3_REGION` (default `us-east-1`), `S3_BUCKET` (default `streamtube`, Hipótese), `S3_ACCESS_KEY` and `S3_SECRET_KEY` (required, no default secret), `S3_CORS_ALLOWED_ORIGINS` (default `*`, Hipótese)
3. Create `src/config/queue.config.ts` — `registerAs('queue', ...)` reading `REDIS_HOST` (default `redis`), `REDIS_PORT` (default `6379`), `QUEUE_PREFIX` (default `bull`), `VIDEO_JOB_ATTEMPTS` (default `3`) and `VIDEO_JOB_BACKOFF_MS` (default `30000`), the last two per `phase-03-videos/TD-11` Revision
4. Create `src/config/videos.config.ts` — `registerAs('videos', ...)` reading `UPLOAD_PART_SIZE_BYTES` (default `67108864`), `UPLOAD_MAX_SIZE_BYTES` (default `10737418240`), `PART_URLS_MAX_BATCH` (default `100`), `PRESIGN_PART_EXPIRES_SECONDS` (default `3600`), `PRESIGN_GET_EXPIRES_SECONDS` (default `900`), `VIDEOS_THROTTLE_LIMIT` (default `120`), `VIDEOS_THROTTLE_TTL_MS` (default `60000`) and `MEDIA_TOOL_TIMEOUT_MS` (default `600000`). All defaults in this SI are Hipótese values of this plan (no TD fixes them) and stay configurable, for the student to confirm
5. Update `src/config/env.validation.ts` (Joi: `UPLOAD_PART_SIZE_BYTES` between `5242880`, the S3 minimum part size confirmed in `phase-03-videos/TD-04` Revision, and `2147483647`, the largest value the `integer` column `part_size_bytes` holds), register the three configs in `AppModule` `load`, update `.env.example` (and the local `.env`) with Compose-network defaults, quoting values that contain shell-special characters (the API and the worker read the bind-mounted `.env`, and Compose interpolates `${S3_ACCESS_KEY}` in `compose.yaml` from the same file), and add the new required keys to the `requiredEnv` fixture of `env.validation.integration-spec.ts` so its existing cases keep passing

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `envValidationSchema` | Integration: required S3 credentials, defaults, part size below 5 MiB rejected | `src/config/env.validation.integration-spec.ts` |

**Dependencies:** SI-03.3

**Acceptance criteria:**

- The application still boots and `GET /` returns `200` when all new variables are provided
- Starting without `S3_ACCESS_KEY` or `S3_SECRET_KEY` fails Joi validation at bootstrap
- `UPLOAD_PART_SIZE_BYTES=1048576` and `UPLOAD_PART_SIZE_BYTES=3000000000` are both rejected by validation
- `package.json` lists the four libraries and does not list `@aws-sdk/lib-storage`
- No service-to-service host in `.env.example` or `compose.yaml` uses `localhost`; `S3_PUBLIC_ENDPOINT` is the only exception

---

### SI-03.5 — Storage module: S3 clients, multipart, presigning and idempotent bucket bootstrap

**Description:** Encapsulate all S3 access in `StorageService` with two clients — an internal one for server-side calls and a public one used only to sign URLs for the browser — and provide a bucket and CORS bootstrap that is idempotent and callable from a script and from test setup (`phase-03-videos/TD-04`, `TD-02`, `TD-03`).

**Technical actions:**

1. Create `src/storage/storage.module.ts` — providers for two `S3Client` instances (`forcePathStyle: true`, `S3_REGION`, credentials; `endpoint` = `S3_ENDPOINT` for the internal client and `S3_PUBLIC_ENDPOINT` for the public one), exporting `StorageService` (per `phase-03-videos/TD-04`). Read the command input shapes from the installed `@aws-sdk/client-s3` types before writing each call (`library-refs.md`: "Not confirmed")
2. Create `src/storage/storage.service.ts` — `createMultipartUpload(key, contentType)` (sets `ContentType` so the object is served with it), `presignUploadPart(key, uploadId, partNumber, expiresIn)` (public client), `listAllParts(key, uploadId)` (follows `ListParts` pagination, up to 1,000 per page), `completeMultipartUpload(key, uploadId, parts)`, `headObject(key)`, `presignGet(key, { expiresIn, downloadFilename?, client })` (`client` is `'public'` for URLs handed to users and `'internal'` for the worker; sets `ResponseContentDisposition` when `downloadFilename` is given) , `putObject(key, body, contentType)` and `downloadToFile(key, path)` (streams the object to a local file; used only by the `phase-03-videos/TD-07` per-job fallback)
3. Add `ensureBucket()` to `StorageService` — `HeadBucket`, `CreateBucket` when absent, then `PutBucketCors` allowing `PUT`, `GET`, `HEAD` from `S3_CORS_ALLOWED_ORIGINS` and exposing `ETag` (per `phase-03-videos/TD-02` Cons and the TD-03 spike); create `src/storage/storage-bootstrap.ts` and the npm script `storage:init` that run it from the command line
4. If the pinned storage rejects the SDK's default checksum headers on a presigned `UploadPart` (`library-refs.md` risk), set `requestChecksumCalculation: 'WHEN_REQUIRED'` on both clients

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration (real storage): `ensureBucket` twice, multipart with presigned parts sent straight to storage, `listAllParts`, complete, `headObject`, presigned GET with `Range` and with content-disposition, `putObject`, `downloadToFile` | `src/storage/storage.service.integration-spec.ts` |
| `StorageService` | Unit: `listAllParts` follows pagination across truncated pages with a stubbed client (1,001 real 5 MiB parts are impractical); the public client signs for the host of `S3_PUBLIC_ENDPOINT` (set to `http://localhost:9000`, no network call) and the internal one for `S3_ENDPOINT` | `src/storage/storage.service.spec.ts` |
| `StorageModule` | Unit: module compiles | `src/storage/storage.module.spec.ts` |

The integration spec sets `S3_PUBLIC_ENDPOINT` to the internal service address (`http://storage:9000`), because a URL signed for the host-published address is unreachable from inside the `nestjs-api` container. The host-published address itself is exercised by a manual `curl` from the host machine against a presigned GET produced by the public client, recorded in `progress.md` (`library-refs.md` requires it).

**Dependencies:** SI-03.4

**Acceptance criteria:**

- `docker compose exec nestjs-api npm run storage:init` run twice in a row exits with code 0 both times, and the bucket ends with CORS exposing `ETag`
- A presigned `UploadPart` URL accepts a direct `PUT` of a 5 MiB part and answers `200` with an `ETag` header
- After completing a two-part upload, `headObject` reports a size equal to the sum of the parts
- A presigned GET answers `206` with `Content-Range` for a `Range: bytes=0-99` request, and a URL signed with a download filename answers with `Content-Disposition: attachment`
- A URL from `presignGet` with `client: 'public'` is signed for the host of `S3_PUBLIC_ENDPOINT`; with `client: 'internal'` it is signed for the host of `S3_ENDPOINT`
- From the host machine, `curl` with `Range: bytes=0-99` on a presigned GET produced by the public client (signed for `localhost:9000`) answers `206`

---

### SI-03.6 — Video entity, migration and test cleanup

**Description:** Create the `Video` entity and its migration exactly as in the Data Model, and extend the shared test utilities so every suite that cleans the database handles the new table (`phase-03-videos/TD-10`, `TD-08`, `TD-02` Revision).

**Technical actions:**

1. Create `src/videos/entities/video.entity.ts` — `@Entity('videos')` with the columns of the Data Model (`VideoStatus` enum `draft | processing | ready | failed`, number transformers for `size_bytes`, `bitrate` and `duration_seconds`, `@ManyToOne(() => Channel, (channel) => channel.videos)` with `@JoinColumn({ name: 'channel_id' })`, a `@Check` for `size_bytes > 0`), and add the inverse side `@OneToMany(() => Video, (video) => video.channel) videos` to `src/channels/entities/channel.entity.ts` (project entity rule: both sides of a relationship)
2. Create `src/videos/videos.module.ts` — `TypeOrmModule.forFeature([Video])`, exporting `TypeOrmModule`; import it in `AppModule` so `autoLoadEntities` registers the entity
3. Generate the migration with `docker compose exec nestjs-api npm run migration:generate -- src/database/migrations/CreateVideos` and review the SQL (enum `videos_status_enum`, FK to `channels`, index on `channel_id`, CHECK on `size_bytes`); never edit it after it has been applied
4. Update `cleanAllTables` in `src/test/create-test-data-source.ts` to delete from `"videos"` before `"channels"`, and extend `src/database/migrations.integration-spec.ts` with the new table, entity and migration (three migrations)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: default `draft`, invalid status rejected, `size_bytes` of 0 rejected, FK to `channels`, nullable processing fields, `bigint` round trip as number, `jsonb` round trip | `src/videos/entities/video.entity.integration-spec.ts` |
| Migration `CreateVideos` | Integration: apply, revert and apply again, enum type removed on revert | `src/database/migrations.integration-spec.ts` |
| `VideosModule` | Unit: module compiles | `src/videos/videos.module.spec.ts` |

**Dependencies:** SI-03.2

**Acceptance criteria:**

- A new `videos` row without `status` is stored as `draft`
- Inserting a `videos` row with a status outside the enum fails, and so does one with `size_bytes` 0
- Deleting a channel that still has videos fails on the FK
- A `size_bytes` of `10737418240` is read back as the number `10737418240`
- The migration applies, reverts and applies again without error, and the revert removes `videos_status_enum`
- `cleanAllTables` empties `videos` before `channels` without an FK error

---

### SI-03.7 — Video queue producer

**Description:** Wire the BullMQ connection and the `video-processing` queue, with a Redis key prefix that tests can override, and expose a producer that enqueues one idempotent job per video with the retry policy of `phase-03-videos/TD-11`.

**Technical actions:**

1. Create `src/queue/queue.constants.ts` — `VIDEO_PROCESSING_QUEUE = 'video-processing'` and `PROCESS_VIDEO_JOB = 'process-video'`
2. Create `src/queue/queue.module.ts` — `BullModule.forRootAsync` with `connection: { host, port }` from `queueConfig` (the option is `connection`, not `redis`, per `library-refs.md`) plus `prefix` from `QUEUE_PREFIX`, and `BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE })`. Confirm in the installed `@nestjs/bullmq` types that the forwarded `prefix` reaches both the Queue and the Worker; if it does not reach the Worker, SI-03.13 creates the Worker with the prefix explicitly
3. Create `src/queue/video-queue.producer.ts` — `VideoQueueProducer.enqueueProcessing(videoId)` calling `queue.add(PROCESS_VIDEO_JOB, { videoId }, { jobId: videoId, attempts, backoff: { type: 'exponential', delay } })` with `attempts` and `delay` from `queueConfig` (per `phase-03-videos/TD-11` Revision); a duplicate `jobId` is ignored by the queue (`library-refs.md`)
4. `QueueModule` exports `BullModule` and `VideoQueueProducer`; the API side imports it into `VideosModule` (added in SI-03.11, where the producer is first used); do **not** register any `@Processor` here

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoQueueProducer` | Integration (real Redis, private `QUEUE_PREFIX`): job name, payload, `jobId = videoId`, `attempts`, exponential backoff; second enqueue of the same video keeps a single job | `src/queue/video-queue.producer.integration-spec.ts` |
| `QueueModule` | Unit: module compiles | `src/queue/queue.module.spec.ts` |

**Dependencies:** SI-03.4

**Acceptance criteria:**

- `enqueueProcessing(videoId)` creates a job named `process-video` whose data is `{ videoId }` and whose id is the `videoId`
- The stored job has `attempts` 3 and an exponential backoff with delay 30000 when the defaults are used
- Calling `enqueueProcessing` twice for the same `videoId` leaves exactly one job in the queue
- A queue created with another `QUEUE_PREFIX` does not see that job, so a test queue never competes with the Compose `video-worker`
- `queue.getWorkers()` returns an empty list while only the API application context is running (confirm the method in the installed `bullmq` types)

---

### SI-03.8 — Endpoint POST /videos (initiate upload)

**Route:** POST /videos
**Test Specs:** see `nestjs-project/specs/videos-initiate-upload.plan.md`
**Authorization:** Authenticated (any user; the video goes to the caller's own channel)

**Description:** Create the draft video and its S3 multipart upload in one step and return what the client needs to slice and upload the file, with the file bytes never touching the API (`phase-03-videos/TD-02`, `TD-10`, `TD-08`). First controller of the phase, so it also sets the per-controller throttle.

**Technical actions:**

1. Add `findByUserId(userId)` to `src/channels/channels.service.ts` (returns `Channel | null`), keeping channel lookups in `ChannelsModule`; add `ChannelNotFoundException` (`CHANNEL_NOT_FOUND`, 404) and `UploadSizeExceededException` (`UPLOAD_SIZE_EXCEEDED`, 400) to `src/common/exceptions/domain.exception.ts`
2. Create `src/videos/dto/initiate-upload.dto.ts` per the Validation Rules; the upper bound `UPLOAD_MAX_SIZE_BYTES` comes from config, so the service throws the domain exception `UploadSizeExceededException` (`UPLOAD_SIZE_EXCEEDED`, 400); services never throw NestJS HTTP exceptions (`.claude/rules/nestjs-services.md`). `content_type` also carries `@MaxLength(127)`, matching its column
3. Create `src/videos/upload-plan.util.ts` — pure function computing `part_size_bytes = max(UPLOAD_PART_SIZE_BYTES, ceil(size_bytes / 10000))` rounded up to a whole MiB and `part_count = ceil(size_bytes / part_size_bytes)`
4. Create `src/videos/videos.service.ts` — `initiateUpload(userId, dto)`: resolve the channel, build `storage_key` (`videos/{videoId}/original.<ext>`), and inside one `dataSource.transaction` insert the draft row with `id = randomUUID()`, call `StorageService.createMultipartUpload`, and save `upload_id`, `part_size_bytes` and `part_count`; if the storage call fails the transaction rolls back and no draft remains
5. Create `src/videos/videos.controller.ts` — `@Controller('videos')`, `@ApiTags('videos')`, `POST /videos` with `@HttpCode(201)`, `@ApiBearerAuth('access-token')`, `@ApiOperation` and one `@ApiResponse` per status of the contract, including `429` (errors reference `ApiErrorEnvelope`), and a `@Throttle` limit read from `videosConfig` (`VIDEOS_THROTTLE_LIMIT` per `VIDEOS_THROTTLE_TTL_MS`) in place of the global 10 requests per minute; confirm in the installed `@nestjs/throttler` types whether `limit` accepts a function, otherwise use a constant. Register `VideosService` and `VideosController` in `VideosModule`, importing `ChannelsModule` and `StorageModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `computeUploadPlan` | Unit: 5 MiB minimum, at most 10,000 parts for 10 GiB, rounding | `src/videos/upload-plan.util.spec.ts` |
| `VideosService.initiateUpload` | Unit: title default, size cap, missing channel (mock repo and storage) | `src/videos/videos.service.spec.ts` |
| `VideosService.initiateUpload` | Integration (real database and storage): draft persisted with `channel_id` and `upload_id`, rollback when storage fails | `src/videos/videos.service.integration-spec.ts` |
| `ChannelsService.findByUserId` | Integration: found and not found | `src/channels/channels.service.integration-spec.ts` |

**Dependencies:** SI-03.5, SI-03.6

**Acceptance criteria:**

- `POST /videos` with a valid token and `{ filename, size_bytes, content_type }` returns `201` with `id` (uuid), `status: "draft"`, `part_size_bytes` and `part_count`, and a `videos` row exists with the caller's `channel_id` and a non-null `upload_id`
- Without `title`, the stored title is the filename without its extension
- A `size_bytes` above `UPLOAD_MAX_SIZE_BYTES` returns `400` with `error: "UPLOAD_SIZE_EXCEEDED"`; a `content_type` that does not start with `video/`, or is longer than 127 characters, returns `400` with `error: "VALIDATION_ERROR"`
- A request without a token returns `401`
- For `size_bytes` of 10 GiB the response has `part_count` at most 10000 and `part_size_bytes` at least 5 MiB
- When the storage call fails, no `videos` row remains
- More than 10 calls in one minute from the same client do not return `429`; the route documents its `429` response in OpenAPI

---

### SI-03.9 — Endpoint POST /videos/:id/upload/part-urls

**Route:** POST /videos/:id/upload/part-urls
**Test Specs:** see `nestjs-project/specs/videos-part-urls.plan.md`
**Authorization:** Authenticated owner of the video, while it is `draft`

**Description:** Give the client batches of presigned `UploadPart` URLs so it sends each part straight to storage (`phase-03-videos/TD-02`), with URLs signed for the public endpoint (`phase-03-videos/TD-04` Revision).

**Technical actions:**

1. Add `VideoNotFoundException` (`VIDEO_NOT_FOUND`, 404), `VideoNotInDraftException` (`VIDEO_NOT_IN_DRAFT`, 409) `InvalidPartNumbersException` (`INVALID_PART_NUMBERS`, 400) and `PartUrlsBatchTooLargeException` (`PART_URLS_BATCH_TOO_LARGE`, 400) to `src/common/exceptions/domain.exception.ts`
2. Create `src/videos/dto/part-urls.dto.ts` — `part_numbers`: array, at least one item, unique, each an integer `>= 1`; the upper bound `PART_URLS_MAX_BATCH` comes from config and is checked in the service, which throws `PartUrlsBatchTooLargeException`
3. Add to `VideosService` a shared `getOwnedDraft(userId, videoId)` (video of the caller's channel, `VIDEO_NOT_FOUND` otherwise — also for another user's video — then `VIDEO_NOT_IN_DRAFT` when `status` is not `draft`) and `createPartUrls(userId, videoId, dto)`, which rejects part numbers above `part_count` and calls `StorageService.presignUploadPart` for each with `PRESIGN_PART_EXPIRES_SECONDS`
4. Add `POST :id/upload/part-urls` to `VideosController` — `@HttpCode(200)`, `ParseUUIDPipe` on `:id`, Swagger decorators for 200, 400, 401, 404 and 409, same `@Throttle` as the controller

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.createPartUrls` | Unit: not found, another owner, not draft, part number above `part_count`, batch above the maximum | `src/videos/videos.service.spec.ts` |
| `VideosService.createPartUrls` | Integration (real database and storage): a returned URL accepts a direct 5 MiB `PUT` | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.8

**Acceptance criteria:**

- `POST /videos/:id/upload/part-urls` with `{ "part_numbers": [1, 2] }` by the owner of a draft returns `200` with two `{ part_number, url }` entries and `expires_in`
- A returned URL accepts a `PUT` of a 5 MiB body sent straight to storage and answers with an `ETag`
- A part number above the video's `part_count` returns `400` with `error: "INVALID_PART_NUMBERS"`; more than `PART_URLS_MAX_BATCH` part numbers returns `400` with `error: "PART_URLS_BATCH_TOO_LARGE"`
- Another user's video, or an unknown id, returns `404` with `error: "VIDEO_NOT_FOUND"`
- A video that is no longer `draft` returns `409` with `error: "VIDEO_NOT_IN_DRAFT"`
- A request without a token returns `401`

---

### SI-03.10 — Endpoint GET /videos/:id/upload/parts

**Route:** GET /videos/:id/upload/parts
**Test Specs:** see `nestjs-project/specs/videos-list-parts.plan.md`
**Authorization:** Authenticated owner of the video, while it is `draft`

**Description:** Let an interrupted client resume by listing the parts storage already holds (`phase-03-videos/TD-02`: "Resume = `ListParts`"). Abort is deliberately not offered: an upload that is never completed stays `draft` (`phase-03-videos/TD-05` Context and Revisions keep uncompleted uploads in `draft` and defer cleanup; the exclusion of an abort endpoint is a student decision of 2026-10-18, recorded in the Revisions of `phase-03-videos/TD-02` and `phase-03-videos/TD-05`).

**Technical actions:**

1. Add `listUploadedParts(userId, videoId)` to `VideosService` — `getOwnedDraft` followed by `StorageService.listAllParts(storage_key, upload_id)`, returning `part_size_bytes`, `part_count` and the parts ordered by `part_number`
2. Create `src/videos/dto/uploaded-parts-response.dto.ts` — response classes with `@ApiProperty` where the Swagger plugin cannot infer the shape
3. Add `GET :id/upload/parts` to `VideosController` — `ParseUUIDPipe` on `:id`, `@ApiBearerAuth('access-token')`, Swagger decorators for 200, 400, 401, 404 and 409

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.listUploadedParts` | Unit: delegates after the ownership and draft checks | `src/videos/videos.service.spec.ts` |
| `VideosService.listUploadedParts` | Integration (real database and storage): two parts sent, listed in order with sizes and ETags | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.9

**Acceptance criteria:**

- After two parts were sent straight to storage, `GET /videos/:id/upload/parts` by the owner returns `200` with both parts ordered by `part_number`, each with `size_bytes` and `etag`
- With no part sent yet it returns `200` with an empty `parts` array
- Another user's video, or an unknown id, returns `404` with `error: "VIDEO_NOT_FOUND"`
- A video that is no longer `draft` returns `409` with `error: "VIDEO_NOT_IN_DRAFT"`
- A request without a token returns `401`

---

### SI-03.11 — Endpoint POST /videos/:id/upload/complete

**Route:** POST /videos/:id/upload/complete
**Test Specs:** see `nestjs-project/specs/videos-complete-upload.plan.md`
**Authorization:** Authenticated owner of the video

**Description:** Finalize the multipart upload, confirm the stored size, move the video to `processing` and enqueue its job, idempotently, so a retried call after a failed enqueue recovers (`phase-03-videos/TD-05`, `TD-11`, `TD-01`).

**Technical actions:**

1. Add `UploadIncompleteException` (`UPLOAD_INCOMPLETE`, 409), `VideoAlreadyProcessedException` (`VIDEO_ALREADY_PROCESSED`, 409) and `VideoSizeMismatchException` (`VIDEO_SIZE_MISMATCH`, 422) to `src/common/exceptions/domain.exception.ts`
2. Add `completeUpload(userId, videoId)` to `VideosService`: load the caller's video under a `pessimistic_write` lock inside a `dataSource.transaction` (concurrent calls serialize; `VIDEO_NOT_FOUND` for another owner). The lookup uses the `channel_id` from `ChannelsService.findByUserId` and a plain `findOne` with the lock and no `relations` (PostgreSQL rejects `FOR UPDATE` on the nullable side of an outer join). When `status` is `draft`: `listAllParts`, fewer than `part_count` → `UPLOAD_INCOMPLETE`, sum of sizes different from `size_bytes` → `VIDEO_SIZE_MISMATCH` (video stays `draft`); then `completeMultipartUpload` with the stored ETags, `headObject` size check, update to `processing` and `upload_id = null`. Recovery branch (Hipótese): when `listAllParts` fails with `NoSuchUpload` because an earlier call finalized the storage object but failed before the database update, call `headObject`; an object of the declared size finishes the update, a missing object answers `UPLOAD_INCOMPLETE`, a different size answers `VIDEO_SIZE_MISMATCH`. Confirm the SDK error name in the installed types
3. Import `QueueModule` in `VideosModule` (it exports `VideoQueueProducer`, SI-03.7). After the transaction commits, call `VideoQueueProducer.enqueueProcessing(videoId)`. When `status` is already `processing`, skip step 2 and only enqueue (the fixed `jobId` makes it safe); `ready` or `failed` → `VIDEO_ALREADY_PROCESSED`
4. Add `POST :id/upload/complete` to `VideosController` — `@HttpCode(202)`, no request body, `ParseUUIDPipe`, Swagger decorators for 202, 400, 401, 404, 409 and 422

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.completeUpload` | Unit: every branch (draft, processing, ready, failed, missing parts, size mismatch) with mocked repository, storage and producer | `src/videos/videos.service.spec.ts` |
| `VideosService.completeUpload` | Integration (real database, storage and Redis with a private prefix): two parts of 5 MiB plus a short last part complete into `processing` with one job; missing part keeps `draft`; size mismatch keeps `draft`; second call does not create a second job; two parallel calls produce one job and both succeed; a storage object finalized by an earlier failed call is recovered | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.7, SI-03.10

**Acceptance criteria:**

- `POST /videos/:id/upload/complete` by the owner after all parts were stored returns `202` with `{ id, status: "processing" }`, and the object exists in storage with the declared size
- The video row ends with `status` `processing` and `upload_id` null, and the queue holds one job whose id is the video id
- Calling it again while `processing` returns `202` again and does not create a second job
- With fewer parts stored than `part_count` it returns `409` with `error: "UPLOAD_INCOMPLETE"` and the video stays `draft`
- When the stored parts do not add up to `size_bytes` it returns `422` with `error: "VIDEO_SIZE_MISMATCH"` and the video stays `draft`
- For a `ready` or `failed` video it returns `409` with `error: "VIDEO_ALREADY_PROCESSED"`
- When an earlier call finalized the storage object but did not update the database, calling `complete` again returns `202` and the video ends `processing` with one job
- Another user's video, or an unknown id, returns `404`; a request without a token returns `401`

---

### SI-03.12 — Media tools: ffprobe and ffmpeg over a presigned URL

**Description:** Wrap `ffprobe` and `ffmpeg` in a service that reads the object through a presigned GET URL, so a 10GB file is never copied locally (`phase-03-videos/TD-07`). This SI also carries the smoke test the TD-07 Revision demands: the real flow against the Compose storage, with a signed URL and `Range` reads (placed here and not in SI-03.5 because it needs the tools; SI-03.5 covers the presigned GET and `Range` behavior of storage itself).

**Technical actions:**

1. Create `src/media/media-tools.service.ts` — `probe(input)` (`input` is a presigned URL, or a local file path for the `TD-07` fallback in SI-03.13) runs `ffprobe -v error -print_format json -show_format -show_streams <url>` and `extractThumbnail(url, durationSeconds)` runs `ffmpeg -ss <offset> -i <url> -frames:v 1 -vf scale=640:-2` into a temporary JPEG, reads it and removes it. Both use `child_process.spawn` with an argument array (no shell) and are killed after `MEDIA_TOOL_TIMEOUT_MS`. Offset is `max(1, duration × 0.1)` seconds, clamped to `0` for a clip shorter than 1 second (per `phase-03-videos/TD-07` Revision; the clamp is Hipótese)
2. Create `src/media/probe-mapper.ts` — pure `mapProbe(raw)` returning `duration_seconds`, `container_format` (`format.format_name`), `video_codec`, `width`, `height` (first video stream), `bitrate` (`format.bit_rate`), `fps` (computed from the `avg_frame_rate` fraction) and the raw JSON; no video stream → `UnsupportedMediaError`
3. Create `src/media/media.errors.ts` — `UnsupportedMediaError` (non-retryable: corrupt or unsupported media) and `MediaToolError` (retryable: timeout, spawn failure, read error). Classify a non-zero exit by the stderr text; the exact messages are recorded from the real corrupt-file test (Hipótese), and an unrecognized failure is retryable
4. Create `src/media/media.module.ts` exporting `MediaToolsService`, and a test helper `src/test/media-fixtures.ts` that generates a small MP4 at test time with `ffmpeg -f lavfi` (no binary fixture is committed, per `phase-03-videos/TD-12`), written without faststart so the `moov` atom sits at the end, plus `src/test/range-counting-proxy.ts`, a small HTTP proxy that forwards to storage and counts the bytes served

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `mapProbe` | Unit: fps fraction, missing bitrate, audio-only input rejected | `src/media/probe-mapper.spec.ts` |
| `MediaToolsService` | Integration (real storage and tools): upload the generated MP4, sign a GET with the internal client, `probe` and `extractThumbnail` over `Range` reads through the byte-counting proxy; corrupt file → `UnsupportedMediaError`; thumbnail is a JPEG 640 px wide | `src/media/media-tools.service.integration-spec.ts` |

**Dependencies:** SI-03.5

**Acceptance criteria:**

- `probe` on a presigned URL of a generated 3-second MP4 returns a duration of about 3 seconds with the expected width, height and codec
- `extractThumbnail` returns a buffer that starts with the JPEG signature and decodes to an image 640 pixels wide
- For a generated MP4 of about 50 MB (high `-b:v`, `moov` at the end), `probe` plus `extractThumbnail` read less than 25% of the object, counted by the proxy (Hipótese threshold; the `TD-07` spike measured 0.15% and 0.35% on a 2 GB file), and the figures are recorded in `progress.md`
- A file of random bytes raises `UnsupportedMediaError`, not `MediaToolError`
- A tool that exceeds `MEDIA_TOOL_TIMEOUT_MS` is killed and raises `MediaToolError`

---

### SI-03.13 — Video processor: metadata, thumbnail and failure policy

**Description:** Consume `process-video` jobs, extract metadata and the thumbnail, and apply the retry and terminal-failure policy, idempotently (`phase-03-videos/TD-01`, `TD-07`, `TD-10`, `TD-11`). The processing logic lives in a service; the BullMQ processor stays thin.

**Technical actions:**

1. Create `src/worker/video-processing.service.ts` — `process(videoId)`: video missing → `UnrecoverableError`; `ready` → return (idempotent); `headObject` fails with not found → `UnrecoverableError`; otherwise presign a GET with the internal client and run `MediaToolsService.probe` and `extractThumbnail` on it; if that read fails with a retryable `MediaToolError`, run the per-job fallback of `phase-03-videos/TD-07` once (`StorageService.downloadToFile` to a temporary file, the same tools on the local path, then delete the file), and only if the fallback also fails let the error stand for the retry policy. Then `StorageService.putObject` at `thumbnails/{videoId}/default.jpg`, then update the metadata fields, `thumbnail_key` and `status = ready` (per the Events/Messages steps)
2. Add `markFailed(videoId, reason)` to the same service — a conditional update (`WHERE status = 'processing'`) that sets `status = failed` and `failure_reason`, so a late event never overwrites a `ready` video. The worker owns its status updates, so it never imports `VideosModule` (and therefore no controller)
3. Create `src/worker/video.processor.ts` — `@Processor(VIDEO_PROCESSING_QUEUE)` class extending `WorkerHost`, delegating to `VideoProcessingService`; map `UnsupportedMediaError` to `UnrecoverableError`; on the worker `failed` event call `markFailed` when the error is unrecoverable or `attemptsMade` reached `attempts`. Confirm the event names and the `attemptsMade` semantics in the installed `bullmq` types (`library-refs.md`: not confirmed), and the lock settings for jobs that run for minutes
4. Create `src/worker/video-processing.module.ts` — a non-root module with `TypeOrmModule.forFeature([Video])`, `StorageModule`, `MediaModule` and `QueueModule`, providing `VideoProcessor` and `VideoProcessingService`. It declares no `ConfigModule.forRoot`, no `TypeOrmModule.forRoot` and no controller, so it can be imported by the worker root module (SI-03.14) and by tests next to `AppModule` without creating a second root DataSource; it is **not** imported by `AppModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingService` | Unit: branches (missing video, already ready, missing object, tool errors) with mocked collaborators | `src/worker/video-processing.service.spec.ts` |
| `VideoProcessingService` | Integration (real database, storage and ffmpeg): generated MP4 → `ready` with all metadata fields and a stored JPEG; the `TD-07` fallback (download, local tools) produces the same result when the URL read is made to fail; second run is a no-op; corrupt file → `failed` with a reason; missing object → `failed` | `src/worker/video-processing.service.integration-spec.ts` |
| `VideoProcessor` | Integration (real Redis, private `QUEUE_PREFIX`, `VIDEO_JOB_ATTEMPTS=2`, backoff 100 ms; the module under test is `VideoProcessingModule`; a retryable failure is injected by overriding `MediaToolsService`): a job runs to `ready`; a retryable error is retried and ends `failed` after the last attempt; an unrecoverable error ends `failed` after one attempt | `src/worker/video.processor.integration-spec.ts` |

**Dependencies:** SI-03.7, SI-03.11, SI-03.12

**Acceptance criteria:**

- A `processing` video whose object is a valid MP4 ends `ready` with `duration_seconds`, `container_format`, `video_codec`, `width`, `height`, `bitrate`, `fps` and `ffprobe_metadata` filled, and `thumbnail_key` set to `thumbnails/{videoId}/default.jpg`, an object that exists in storage
- Processing the same video twice leaves it `ready` with the same keys and does not fail
- A corrupt file ends `failed` after a single attempt, with a non-empty `failure_reason`
- A missing object ends `failed` after a single attempt
- A retryable error is retried until the configured number of attempts and then ends `failed`
- A `ready` video is never moved back to `failed` by a late event

---

### SI-03.14 — Worker entrypoint and Compose service video-worker

**Description:** Start the processor in its own container from the same image as the API, through a second Nest entrypoint, so the queue consumer is a real Compose service as in the architecture diagram (`phase-03-videos/TD-06`, Option C).

**Technical actions:**

1. Create `src/worker/worker.module.ts` — the worker **root** module: `ConfigModule.forRoot` (same `load` list and validation as `AppModule`), `TypeOrmModule.forRootAsync` (same database config), `QueueModule` and `VideoProcessingModule`; no controller. Create `src/worker.ts` — `NestFactory.createApplicationContext(WorkerModule)` with `enableShutdownHooks()` so the BullMQ worker closes cleanly on stop (confirm graceful shutdown in the Nest docs; `library-refs.md` marks it as not confirmed); no HTTP port is opened; after startup it logs `Video worker listening on queue video-processing` with the Nest `Logger`
2. Add npm scripts to `package.json`: `start:worker` running `src/worker.ts` through `ts-node -r tsconfig-paths/register` (the invocation `openapi:export` and `seed` already use; confirm which `--compiler-options` the project's tsconfig needs) and `start:worker:prod` running `node dist/worker`. The dev worker deliberately does not use `nest start`: with `deleteOutDir: true` in `nest-cli.json`, a second compiler writing the shared bind-mounted `dist/` would delete the output of the API dev server and break it
3. Add service `video-worker` to `compose.yaml` — same `build` and bind mount as `nestjs-api`, `command` running `npm run start:worker`, `depends_on` `db` (healthy), `redis` and `storage`, the same bind-mounted `.env` (no separate environment block), no published ports. The local `compose.override.yaml` (unversioned) mounts the `node_modules` volume only for `nestjs-api`; keep it working by adding the same `video-worker` entry there, but the versioned `compose.yaml` must run without it

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `WorkerModule` | Unit: module compiles, registers the processor and declares no controller | `src/worker/worker.module.spec.ts` |

**Dependencies:** SI-03.13

**Acceptance criteria:**

- `docker compose up -d video-worker` leaves the service running and its log contains `Video worker listening on queue video-processing` and no HTTP port is published
- With only `nestjs-api` running (and no `video-worker`), a job added to the queue stays waiting: the API process does not consume jobs
- With `video-worker` running, a `processing` video enqueued through `POST /videos/:id/upload/complete` reaches `ready` without any other process
- Stopping the service (`docker compose stop video-worker`) ends the process without a stalled-job error in the log

---

### SI-03.15 — Endpoint GET /videos/:id (with optional authentication)

**Route:** GET /videos/:id
**Test Specs:** see `nestjs-project/specs/videos-get.plan.md`
**Authorization:** Anonymous or authenticated; the owner sees any status, everyone else only `ready`

**Description:** The unique URL of a video returns its metadata and status (`phase-03-videos/TD-08`, `TD-10`), with the access rule of the `phase-03-videos/TD-09` Revision. A public route has to know who the caller is when a token is present, so this SI adds an opt-in optional authentication to the Phase 02 guard without changing any existing route.

**Technical actions:**

1. Create `src/auth/decorators/optional-auth.decorator.ts` (`OPTIONAL_AUTH_KEY`, `OptionalAuth()`) and extend `src/auth/guards/jwt-auth.guard.ts`: on a `@Public()` route that also carries `@OptionalAuth()`, no `Authorization` header passes as anonymous, a valid token sets `request.user`, and a token that is present but invalid or expired throws `UnauthorizedException` (student decision, 2026-10-18). Routes that are `@Public()` without `@OptionalAuth()` and protected routes keep their current behavior
2. Add `getVisibleVideo(userId | undefined, videoId)` to `VideosService` — loads the video with its channel owner, returns it with an `isOwner` flag when the caller owns it or the status is `ready`, otherwise throws `VideoNotFoundException` (the 404 hides drafts, student decision, 2026-10-18)
3. Create `src/videos/dto/video-response.dto.ts` and a mapper — fields of the `GET /videos/:id` response; `ffprobe_metadata`, `upload_id` and `storage_key` are never exposed and `failure_reason` is `null` unless `isOwner`
4. Add `GET :id` to `VideosController` with `@Public()`, `@OptionalAuth()`, `ParseUUIDPipe`, the Swagger decorators for 200, 400, 401 and 404, and an optional `Authorization` header documented with `@ApiHeader` (no `@ApiBearerAuth`, which the controller rules forbid on `@Public()` routes)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `JwtAuthGuard` | Unit: public only, public with optional auth and no header, with a valid token, with an invalid token, with an expired token; protected routes unchanged | `src/auth/guards/jwt-auth.guard.spec.ts` |
| `VideosService.getVisibleVideo` | Unit: visibility matrix of owner, other user and anonymous against the four statuses | `src/videos/videos.service.spec.ts` |
| `VideosService.getVisibleVideo` | Integration (real database): owner reads a `draft`, another user gets `VIDEO_NOT_FOUND`, anyone reads a `ready` video | `src/videos/videos.service.integration-spec.ts` |
| Video response mapper | Unit: hidden fields, `failure_reason` only for the owner | `src/videos/dto/video-response.dto.spec.ts` |

**Dependencies:** SI-03.9 _(reuses `VideoNotFoundException` and the ownership lookup of `VideosService`; SI-03.8 comes through it)_

**Acceptance criteria:**

- `GET /videos/:id` for a `ready` video without a token returns `200` with the metadata and none of `ffprobe_metadata`, `upload_id` or `storage_key`
- The owner reads the same route for a `draft`, `processing` or `failed` video and gets `200`, and `failure_reason` appears only for the owner
- Another user, or an anonymous visitor, requesting a `draft`, `processing` or `failed` video gets `404` with `error: "VIDEO_NOT_FOUND"`
- A malformed or expired `Authorization` header on this route returns `401`
- A non-uuid `:id` returns `400` with `error: "VALIDATION_ERROR"`
- The existing public routes of Phase 02 still answer without a token, and protected routes still return `401` without one

---

### SI-03.16 — Endpoint GET /videos/:id/stream

**Route:** GET /videos/:id/stream
**Test Specs:** see `nestjs-project/specs/videos-stream.plan.md`
**Authorization:** Anonymous or authenticated; the owner sees any status except `draft`, everyone else only `ready`

**Description:** Return a short-lived presigned GET URL so the player reads the file straight from storage and seeks with `Range` requests answered `206` (`phase-03-videos/TD-09`). The answer is JSON `{ url, expires_in }` (student decision, 2026-10-18), because an owner watching a non-ready video must send `Authorization`, which `<video>` tags cannot.

**Technical actions:**

1. Add `FileNotAvailableException` (`VIDEO_FILE_NOT_AVAILABLE`, 409) to `src/common/exceptions/domain.exception.ts`
2. Add `getStreamUrl(userId | undefined, videoId)` to `VideosService` — `getVisibleVideo`, then `VIDEO_FILE_NOT_AVAILABLE` when the status is `draft`, then `StorageService.presignGet(storage_key, { client: 'public', expiresIn: PRESIGN_GET_EXPIRES_SECONDS })`
3. Create `src/videos/dto/presigned-url-response.dto.ts` (`url`, `expires_in`), shared by the stream, download and thumbnail routes
4. Add `GET :id/stream` to `VideosController` with `@Public()`, `@OptionalAuth()`, `ParseUUIDPipe` and Swagger decorators for 200, 400, 401, 404 and 409

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.getStreamUrl` | Unit: access rule and the `draft` case | `src/videos/videos.service.spec.ts` |
| `VideosService.getStreamUrl` | Integration (real database and storage): the returned URL answers `206` with `Content-Range` to a `Range` request; owner of a `draft` gets `VIDEO_FILE_NOT_AVAILABLE` | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.15

**Acceptance criteria:**

- `GET /videos/:id/stream` for a `ready` video returns `200` with `url` and `expires_in`
- A `GET` on the returned `url` with `Range: bytes=0-99` answers `206` with a `Content-Range` header and 100 bytes
- The owner of a `processing` video gets `200`; the owner of a `draft` gets `409` with `error: "VIDEO_FILE_NOT_AVAILABLE"`
- Another user or an anonymous visitor asking for a non-`ready` video gets `404` with `error: "VIDEO_NOT_FOUND"`
- A present but invalid token returns `401`

---

### SI-03.17 — Endpoint GET /videos/:id/download

**Route:** GET /videos/:id/download
**Test Specs:** see `nestjs-project/specs/videos-download.plan.md`
**Authorization:** Anonymous or authenticated; the owner sees any status except `draft`, everyone else only `ready`

**Description:** Same mechanism as streaming, with the content-disposition signed into the URL so the browser saves the file under its original name (`phase-03-videos/TD-09`).

**Technical actions:**

1. Add `getDownloadUrl(userId | undefined, videoId)` to `VideosService` — same checks as `getStreamUrl`, then `presignGet(storage_key, { client: 'public', expiresIn, downloadFilename: original_filename })`. In `StorageService.presignGet`, build `ResponseContentDisposition` as `attachment; filename="<ASCII fallback>"; filename*=UTF-8''<percent-encoded name>` so names with accents survive (Hipótese: the encoding is not fixed by any TD)
2. Extend `PresignedUrlResponse` with the optional `filename` and add `GET :id/download` to `VideosController` with `@Public()`, `@OptionalAuth()`, `ParseUUIDPipe` and Swagger decorators for 200, 400, 401, 404 and 409

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.getDownloadUrl` | Unit: access rule and the `draft` case | `src/videos/videos.service.spec.ts` |
| `VideosService.getDownloadUrl` | Integration (real database and storage): the URL answers `Content-Disposition: attachment` with the original name, including an accented name | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.16

**Acceptance criteria:**

- `GET /videos/:id/download` for a `ready` video returns `200` with `url`, `expires_in` and `filename` equal to `original_filename`
- A `GET` on the returned `url` answers with `Content-Disposition` starting with `attachment` and carrying the original file name
- A file named `Vídeo ação.mp4` is delivered with its accented name preserved in `filename*`
- The owner of a `draft` gets `409` with `error: "VIDEO_FILE_NOT_AVAILABLE"`; another user or anonymous on a non-`ready` video gets `404` with `error: "VIDEO_NOT_FOUND"`

---

### SI-03.18 — Endpoint GET /videos/:id/thumbnail

**Route:** GET /videos/:id/thumbnail
**Test Specs:** see `nestjs-project/specs/videos-thumbnail.plan.md`
**Authorization:** Anonymous or authenticated; the owner once the thumbnail exists, everyone else only for a `ready` video

**Description:** Return a presigned GET URL for the thumbnail generated by the worker, with the same access rule as the video (`phase-03-videos/TD-09` Revision).

**Technical actions:**

1. Add `ThumbnailNotAvailableException` (`THUMBNAIL_NOT_AVAILABLE`, 409) to `src/common/exceptions/domain.exception.ts`
2. Add `getThumbnailUrl(userId | undefined, videoId)` to `VideosService` — `getVisibleVideo`, `THUMBNAIL_NOT_AVAILABLE` when `thumbnail_key` is null, then `presignGet(thumbnail_key, { client: 'public', expiresIn })`
3. Add `GET :id/thumbnail` to `VideosController` with `@Public()`, `@OptionalAuth()`, `ParseUUIDPipe` and Swagger decorators for 200, 400, 401, 404 and 409

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.getThumbnailUrl` | Unit: access rule and the missing thumbnail case | `src/videos/videos.service.spec.ts` |
| `VideosService.getThumbnailUrl` | Integration (real database and storage): the URL returns the stored JPEG | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.16

**Acceptance criteria:**

- `GET /videos/:id/thumbnail` for a `ready` video returns `200` with `url` and `expires_in`, and a `GET` on `url` returns image bytes that start with the JPEG signature
- For a video whose `thumbnail_key` is still null it returns `409` with `error: "THUMBNAIL_NOT_AVAILABLE"`
- Another user or an anonymous visitor asking for a non-`ready` video gets `404` with `error: "VIDEO_NOT_FOUND"`
- A present but invalid token returns `401`

---

### SI-03.19 — End-to-end upload flow, OpenAPI export and 10GB smoke

**Description:** Prove the whole pipeline with real services (register → upload straight to storage → complete → worker → ready → stream, download, thumbnail), refresh the exported OpenAPI contract, and run the manual 10GB check that the `phase-03-videos/TD-02` Revision requires as the acceptance criterion for "no impact on performance".

**Technical actions:**

1. Create `test/videos.e2e-spec.ts` — boots `AppModule` plus `VideoProcessingModule` (never `WorkerModule`, which would add a second root DataSource) in the same process (real Redis with a private `QUEUE_PREFIX`, real storage, real ffmpeg), registers, confirms (capturing the confirmation token through the mail service, as `test/auth.e2e-spec.ts` does) and logs in two users, and runs the flow: `POST /videos`, `part-urls`, `PUT` of each part straight to the returned storage URLs with `fetch` (the file never appears in a supertest request), `complete`, polling `GET /videos/:id` until `ready`, then `stream`, `download` and `thumbnail` and a `Range` read on the stream URL. Negative paths: the other user gets `404` on a non-ready video, an anonymous visitor reads the `ready` one
2. Set `S3_PUBLIC_ENDPOINT` to the internal storage address in the e2e environment (a URL signed for the host-published address is unreachable inside `nestjs-api`) and call `StorageService.ensureBucket()` in `beforeAll`
3. Regenerate `openapi.json` with `docker compose exec nestjs-api npm run openapi:export` and review that the eight operations of this phase are present with their error responses referencing `ApiErrorEnvelope`; add the new requests to `api.http`
4. Run the manual 10GB smoke: create a sparse 10 GiB file, initiate the upload, send the parts in parallel straight to storage with `curl`, from the host machine and using the URLs exactly as `part-urls` returns them (signed for `S3_PUBLIC_ENDPOINT`, which exercises the host-published address), and while it runs measure the latency of `GET /` against the API. Record the commands, the part size, the elapsed time and the latency numbers in `progress.md` (the sparse file is not a valid video, so the worker ends it `failed`; the check is about the upload and the API staying responsive, not about processing)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Upload and processing flow | E2E (real services, supertest for the API, `fetch` for storage) | `test/videos.e2e-spec.ts` |
| OpenAPI export | Integration: the document contains the `videos` paths and the shared error envelope on their error responses | `src/openapi-export.integration-spec.ts` |

**Dependencies:** SI-03.11, SI-03.14, SI-03.18

**Acceptance criteria:**

- The e2e flow ends with the video `ready`, a stream URL that answers `206` to a `Range` request, a download URL that answers with `Content-Disposition: attachment`, and a thumbnail URL that returns a JPEG
- Every request the e2e test sends to the API carries only JSON; the part bytes go only to the storage URLs
- `openapi.json` lists `/videos`, `/videos/{id}`, `/videos/{id}/upload/part-urls`, `/videos/{id}/upload/parts`, `/videos/{id}/upload/complete`, `/videos/{id}/stream`, `/videos/{id}/download` and `/videos/{id}/thumbnail`
- `components.schemas` holds non-empty `properties` for the video response DTOs (request DTOs follow the project rule of relying on the Swagger plugin, which does not run under the `openapi:export` ts-node script: a gap that already leaves the Phase 02 request DTOs empty in `openapi.json`, out of scope here and reported as a follow-up)
- `progress.md` holds the 10GB smoke result, showing the API answering `GET /` during the upload without errors

---

### SI-03.20 — Update CLAUDE.md (root and nestjs-project) from the implemented code

**Description:** Only after the phase is implemented, document the videos module, endpoints, queue and worker, storage, Compose services and environment variables from the real code, in both `CLAUDE.md` files, and record the storage substitution and the public-endpoint exception (`phase-03-videos/TD-03` and `TD-04` Revisions). The project instructions require this update to come from the code, not from this plan.

**Technical actions:**

1. Update `CLAUDE.md` (root) — replace "Message Queue (TBD)" with BullMQ on Redis, correct the "`next-frontend/` — not yet initialized" line (the directory exists), add the Phase 03 services to the container list, and note that MinIO is served by `pgsty/silo` with the pinned tag
2. Update `nestjs-project/CLAUDE.md` — services (`storage`, `redis`, `video-worker`), the `videos`, `storage`, `queue`, `media` and `worker` modules, the eight endpoints, the worker commands (`start:worker`, `storage:init`), every new environment variable with its default, and the `S3_PUBLIC_ENDPOINT` exception to the "never `localhost`" rule
3. Check each statement against the code with Read, Glob and Grep before writing it; anything not found in the code is left out

**Tests:**

_(empty — documentation only)_

**Dependencies:** SI-03.19

**Acceptance criteria:**

- Every file, service, route and variable named in the two `CLAUDE.md` files exists in the repository
- Neither file still says "Message Queue (TBD)" or that `next-frontend/` is not initialized
- The `S3_PUBLIC_ENDPOINT` exception and the `pgsty/silo` substitution (with its pinned tag) are documented

---

## Technical Specifications

### Data Model

_Labels used below: **(per TD)** = fixed by a decided TD or its Revision; **Hipótese** = defined by this plan because no TD fixes it, kept configurable or trivially reversible, to be confirmed by the student. Field names are snake_case, as in `users` and `channels`._

#### Video

Table `videos`, entity `Video` in `src/videos/entities/video.entity.ts`.

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK. Assigned by `VideosService` with `crypto.randomUUID()` before the storage key is built; it is the public identifier of `/videos/{id}` (per `phase-03-videos/TD-08`) |
| channel_id | uuid | FK → `channels.id`, not null, indexed. Owner of the video (per `phase-03-videos/TD-02` Revision) |
| title | varchar(255) | not null. Defaults to `original_filename` without extension when the client sends none (per `phase-03-videos/TD-02` Revision). Length: Hipótese |
| original_filename | varchar(255) | not null |
| content_type | varchar(127) | not null. Sent to storage in `CreateMultipartUpload` so the object is served with it. Length: Hipótese |
| size_bytes | bigint | not null, `CHECK (size_bytes > 0)`. Column transformer string ↔ number (TypeORM returns `bigint` as string; 10GB fits in a JS number). Transformer: Hipótese |
| status | enum `videos_status_enum` (`draft`, `processing`, `ready`, `failed`) | not null, default `draft` (per `phase-03-videos/TD-10`) |
| upload_id | varchar(255) | nullable. S3 multipart `UploadId`, set at initiation, set to null when the upload is completed (per `phase-03-videos/TD-02`; clearing it: Hipótese) |
| part_size_bytes | integer | nullable until initiation completes. Fixed per video so the client slices consistently and `ListParts` can be validated (per `phase-03-videos/TD-02`) |
| part_count | integer | nullable until initiation completes. `ceil(size_bytes / part_size_bytes)`, `<= 10000` (limit confirmed in `phase-03-videos/TD-04` Revision) |
| storage_key | varchar(512) | not null. `videos/{videoId}/original.<ext>`; `<ext>` is the lowercase extension of `original_filename` when it matches `[a-z0-9]{1,10}`, otherwise the key ends in `original` (key shape per `phase-03-videos/TD-04`; extension rule: Hipótese) |
| thumbnail_key | varchar(512) | nullable. `thumbnails/{videoId}/default.jpg`, set by the worker (per `phase-03-videos/TD-04`, `TD-07`) |
| duration_seconds | numeric(12,3) | nullable. Set by the worker (per `phase-03-videos/TD-07` Revision). Column transformer string ↔ number: Hipótese |
| container_format | varchar(255) | nullable. ffprobe `format.format_name` (per `phase-03-videos/TD-07` Revision: "container") |
| video_codec | varchar(64) | nullable. ffprobe `codec_name` of the first video stream (per `phase-03-videos/TD-07` Revision: "codec") |
| width | integer | nullable (per `phase-03-videos/TD-07` Revision) |
| height | integer | nullable (per `phase-03-videos/TD-07` Revision) |
| bitrate | bigint | nullable. bits per second, ffprobe `format.bit_rate`, with the same number transformer (per `phase-03-videos/TD-07` Revision) |
| fps | numeric(8,3) | nullable. Computed from ffprobe `avg_frame_rate` (per `phase-03-videos/TD-07` Revision) |
| ffprobe_metadata | jsonb | nullable. Raw ffprobe JSON (per `phase-03-videos/TD-07` Revision) |
| failure_reason | text | nullable. Set when `status` becomes `failed` (per `phase-03-videos/TD-10`: "`failed` carries a reason column") |
| created_at | timestamp | `CreateDateColumn` |
| updated_at | timestamp | `UpdateDateColumn` |

**Relations:** `Video` many-to-one `Channel` through `channel_id` (no cascade, FK `NO ACTION` like the Phase 02 FKs). `Channel` has many `Video` through the inverse `videos` property added to `channel.entity.ts` (project entity rule: both sides of a relationship).
**Indexes:** non-unique on `channel_id` (Phase 04 lists a channel's videos).

**Status lifecycle (per `phase-03-videos/TD-10`, `TD-05`, `TD-11`):**

| From | To | Trigger |
|------|----|---------|
| (new) | `draft` | `POST /videos` creates the row and the multipart upload |
| `draft` | `processing` | `POST /videos/:id/upload/complete` finalizes the multipart upload and enqueues the job |
| `processing` | `ready` | the worker stores metadata and the thumbnail |
| `processing` | `failed` | non-retryable error, or last retry exhausted; `failure_reason` is set |

`ready` and `failed` are terminal in Phase 03 (no re-trigger endpoint, per `phase-03-videos/TD-11` Revision). Uploads never completed stay in `draft` (per `phase-03-videos/TD-05` Revision).

### API Contracts

_Backend tier only: no UI scope in this phase, so no BFF tier. All routes live under `@Controller('videos')` (plural noun, no global prefix), JSON bodies use snake_case like `refresh_token`, errors use the Phase 02 envelope `{ statusCode, error, message }` (per `phase-02-auth/TD-07`). Every route is documented with `@nestjs/swagger` decorators (per `openapi-docs-nestjs/TD-01` Revision). The file bytes never appear in any request or response below: the client PUTs parts straight to storage (per `phase-03-videos/TD-02` Revision)._

_Authentication: routes marked "Auth" require `Authorization: Bearer <access_token>` (global guard, Phase 02). Routes marked "Optional auth" carry `@Public()` plus the new `@OptionalAuth()` (SI-03.15): no header means anonymous; a valid token sets `request.user`; a present but invalid or expired token returns `401` (student decision, 2026-10-18). Every `videos` route carries its own `@Throttle` limit instead of the global 10 requests per minute (student decision, 2026-10-18; values are env-configurable Hipótese)._

#### POST /videos (SI-03.8)

Auth. Creates the draft video and the S3 multipart upload (per `phase-03-videos/TD-02`, `TD-10`).

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer <access_token>

**Request body:**
- filename: string, required — 1 to 255 characters (`original_filename`)
- size_bytes: integer, required — `>= 1`; the upper bound `UPLOAD_MAX_SIZE_BYTES` (Hipótese: default `10737418240`, i.e. 10 GiB) is checked in the service
- content_type: string, required — must start with `video/` (Hipótese), at most 127 characters
- title: string, optional — 1 to 255 characters; default is `filename` without extension (per `phase-03-videos/TD-02` Revision)

**Response 201:**
- id: string (uuid) — the video identifier used in every other URL (per `phase-03-videos/TD-08`)
- title: string
- status: string — always `draft`
- size_bytes: integer
- part_size_bytes: integer — `max(UPLOAD_PART_SIZE_BYTES, ceil(size_bytes / 10000))`, rounded up to a whole MiB (Hipótese for the default `67108864`, 64 MiB; TD-02 suggests 64–128 MiB)
- part_count: integer — `ceil(size_bytes / part_size_bytes)`, `<= 10000`

**Error responses:**
- 400 VALIDATION_ERROR: body fails validation (empty filename, `size_bytes` below 1, `content_type` not `video/*` or longer than 127 characters)
- 400 UPLOAD_SIZE_EXCEEDED: `size_bytes` is above `UPLOAD_MAX_SIZE_BYTES`
- 429: the route's own throttle limit was exceeded
- 401: missing, invalid or expired access token
- 404 CHANNEL_NOT_FOUND: the authenticated user has no channel (should not happen; Phase 02 creates it at registration)

---

#### POST /videos/:id/upload/part-urls (SI-03.9)

Auth, owner only, `status = draft`. Returns presigned `UploadPart` URLs for the client to PUT each part straight to storage (per `phase-03-videos/TD-02`). URLs are signed for `S3_PUBLIC_ENDPOINT` (per `phase-03-videos/TD-04` Revision).

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer <access_token>

**Request body:**
- part_numbers: integer[], required — distinct, each `>= 1`; at most `PART_URLS_MAX_BATCH` items (Hipótese: default `100`), checked in the service

**Response 200:**
- urls: object[] — `{ part_number: integer, url: string }`, one per requested part
- expires_in: integer — seconds the URLs stay valid (`PRESIGN_PART_EXPIRES_SECONDS`, Hipótese: default `3600`)

**Error responses:**
- 400 VALIDATION_ERROR: body fails validation, or `:id` is not a uuid
- 400 INVALID_PART_NUMBERS: a requested part number is greater than the video's `part_count`
- 400 PART_URLS_BATCH_TOO_LARGE: more than `PART_URLS_MAX_BATCH` part numbers were requested
- 401: missing, invalid or expired access token
- 404 VIDEO_NOT_FOUND: the video does not exist or belongs to another channel
- 409 VIDEO_NOT_IN_DRAFT: the upload was already completed

---

#### GET /videos/:id/upload/parts (SI-03.10)

Auth, owner only, `status = draft`. Lists the parts already stored, so an interrupted client resumes (per `phase-03-videos/TD-02`: "Resume = `ListParts`"). The service follows `ListParts` pagination (1,000 parts per page).

**Request headers:**
- Authorization: Bearer <access_token>

**Response 200:**
- part_size_bytes: integer
- part_count: integer
- parts: object[] — `{ part_number: integer, size_bytes: integer, etag: string }`, ordered by `part_number`

**Error responses:**
- 400 VALIDATION_ERROR: `:id` is not a uuid
- 401: missing, invalid or expired access token
- 404 VIDEO_NOT_FOUND: the video does not exist or belongs to another channel
- 409 VIDEO_NOT_IN_DRAFT: the upload was already completed

---

#### POST /videos/:id/upload/complete (SI-03.11)

Auth, owner only. Finalizes the multipart upload, verifies the stored size, moves the video to `processing` and enqueues the job (per `phase-03-videos/TD-05`). The client sends no ETags: the API reads them with `ListParts`. Idempotent: calling it again while `status = processing` re-enqueues with the same `jobId` and returns the same response (per `phase-03-videos/TD-11`, which makes the dual write safe). If an earlier call finalized the storage object but failed before the database update, the next call finds the upload gone (`NoSuchUpload`), confirms the object with `HeadObject` and finishes the update (Hipótese: recovery branch of this plan).

**Request headers:**
- Authorization: Bearer <access_token>

**Request body:** none.

**Response 202:**
- id: string (uuid)
- status: string — `processing`

(`202 Accepted` because processing is asynchronous: Hipótese.)

**Error responses:**
- 400 VALIDATION_ERROR: `:id` is not a uuid
- 401: missing, invalid or expired access token
- 404 VIDEO_NOT_FOUND: the video does not exist or belongs to another channel
- 409 UPLOAD_INCOMPLETE: stored parts are fewer than `part_count`
- 409 VIDEO_ALREADY_PROCESSED: `status` is `ready` or `failed`
- 422 VIDEO_SIZE_MISMATCH: the sum of stored part sizes, or the object size after completion, differs from `size_bytes`. Checked first from `ListParts` (before finalizing, so the video stays `draft` and the client can re-send parts), then confirmed with `HeadObject`

---

#### GET /videos/:id (SI-03.15)

Optional auth. Video metadata, used by clients to poll `status` (per `phase-03-videos/TD-08`: `/videos/{id}` is the unique URL; `TD-10`: observable status). Access rule (per `phase-03-videos/TD-09` Revision): the owner sees the video in any status; anyone else, including anonymous visitors, only when `status = ready`.

**Request headers:**
- Authorization: Bearer <access_token> — optional

**Response 200:**
- id: string (uuid)
- channel_id: string (uuid)
- title: string
- status: string — `draft`, `processing`, `ready` or `failed`
- original_filename: string
- content_type: string
- size_bytes: integer
- duration_seconds: number | null
- container_format: string | null
- video_codec: string | null
- width: integer | null
- height: integer | null
- bitrate: integer | null
- fps: number | null
- failure_reason: string | null — present only for the owner; `null` for anyone else
- created_at: string (ISO 8601)
- updated_at: string (ISO 8601)

The raw `ffprobe_metadata`, `upload_id` and `storage_key` are never returned.

**Error responses:**
- 400 VALIDATION_ERROR: `:id` is not a uuid
- 401: a token was sent but is invalid or expired
- 404 VIDEO_NOT_FOUND: the video does not exist, or is not `ready` and the caller is not the owner (student decision, 2026-10-18: 404, not 403, so drafts are not revealed)

---

#### GET /videos/:id/stream (SI-03.16)

Optional auth, same access rule as `GET /videos/:id`. Returns a short-lived presigned GET URL; the client plays it directly and storage answers `Range` requests with `206` (per `phase-03-videos/TD-09`; format JSON, not a redirect — student decision, 2026-10-18).

**Request headers:**
- Authorization: Bearer <access_token> — optional

**Response 200:**
- url: string — presigned GET URL for `storage_key`, signed for `S3_PUBLIC_ENDPOINT`
- expires_in: integer — seconds (`PRESIGN_GET_EXPIRES_SECONDS`, Hipótese: default `900`, the SDK default)

**Error responses:**
- 400 VALIDATION_ERROR: `:id` is not a uuid
- 401: a token was sent but is invalid or expired
- 404 VIDEO_NOT_FOUND: same rule as `GET /videos/:id`
- 409 VIDEO_FILE_NOT_AVAILABLE: the owner asks for a video still in `draft` (no stored object yet)

---

#### GET /videos/:id/download (SI-03.17)

Optional auth, same access rule. Same mechanism as `stream`, with `ResponseContentDisposition: attachment` so the browser saves the file under `original_filename` (per `phase-03-videos/TD-09`; the filename is encoded as `filename*=UTF-8''<percent-encoded>` so non-ASCII names survive: Hipótese).

**Request headers:**
- Authorization: Bearer <access_token> — optional

**Response 200:**
- url: string — presigned GET URL carrying `response-content-disposition`
- expires_in: integer
- filename: string — `original_filename`

**Error responses:**
- 400 VALIDATION_ERROR, 401, 404 VIDEO_NOT_FOUND, 409 VIDEO_FILE_NOT_AVAILABLE: same as `stream`

---

#### GET /videos/:id/thumbnail (SI-03.18)

Optional auth, same access rule (per `phase-03-videos/TD-09` Revision: "read the thumbnail").

**Request headers:**
- Authorization: Bearer <access_token> — optional

**Response 200:**
- url: string — presigned GET URL for `thumbnail_key`
- expires_in: integer

**Error responses:**
- 400 VALIDATION_ERROR, 401, 404 VIDEO_NOT_FOUND: same as `stream`
- 409 THUMBNAIL_NOT_AVAILABLE: `thumbnail_key` is still null (video not processed yet, or `failed`)

---

#### Validation Rules — videos

- `filename`: required string, 1–255 characters
- `size_bytes`: required integer, `>= 1` (the upper bound `UPLOAD_MAX_SIZE_BYTES` is a domain check, `UPLOAD_SIZE_EXCEEDED`)
- `content_type`: required string matching `^video/`, at most 127 characters
- `title`: optional string, 1–255 characters
- `part_numbers`: required array of distinct integers `>= 1`, 1 to `PART_URLS_MAX_BATCH` items
- `:id`: `ParseUUIDPipe`

### Authorization Matrix

_"Owner" = the authenticated user whose channel (`channels.user_id`, from the JWT `sub`) holds `videos.channel_id`. "Other user" = authenticated, not the owner. A ✗ on an owner-only route answers `404 VIDEO_NOT_FOUND` for an existing video (not 403), so another user cannot learn that a draft exists._

| Endpoint | Anonymous | Other user | Owner |
|----------|-----------|------------|-------|
| POST /videos | ✗ (401) | ✓ (creates in their own channel) | ✓ |
| POST /videos/:id/upload/part-urls | ✗ (401) | ✗ (404) | ✓ while `draft` |
| GET /videos/:id/upload/parts | ✗ (401) | ✗ (404) | ✓ while `draft` |
| POST /videos/:id/upload/complete | ✗ (401) | ✗ (404) | ✓ |
| GET /videos/:id | ✓ only `ready` | ✓ only `ready` | ✓ any status |
| GET /videos/:id/stream | ✓ only `ready` | ✓ only `ready` | ✓ any status except `draft` (409) |
| GET /videos/:id/download | ✓ only `ready` | ✓ only `ready` | ✓ any status except `draft` (409) |
| GET /videos/:id/thumbnail | ✓ only `ready` | ✓ only `ready` | ✓ once `thumbnail_key` exists (409 before) |

Rule source: `phase-03-videos/TD-09` Revision (owner in any status; others only when `ready`), `phase-03-videos/TD-02` Revision (channel owns the video), and the student's 2026-10-18 decisions (404 for hidden videos, 401 for a present but invalid token). Public visibility and unlisted links are added by Phase 04 on top of this rule. Interpretation to confirm (Hipótese): the `TD-09` Revision says the owner may stream and download "in any status"; while the video is `draft` the multipart upload is not finalized and no object exists, so those two routes answer `409 VIDEO_FILE_NOT_AVAILABLE` instead of a URL that would end in a 404 at storage.

### Error Catalog

_Envelope: `{ statusCode, error, message }`, where `error` is the `errorCode` (per `phase-02-auth/TD-07`, implemented by `DomainException` and `DomainExceptionFilter`). Validation failures keep the existing `VALIDATION_ERROR` shape. Codes marked Hipótese are named by this plan; no TD fixes them. New classes are added next to the Phase 02 ones in `src/common/exceptions/domain.exception.ts`._

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| VALIDATION_ERROR | 400 | Body or `:id` fails validation, including `content_type` not `video/*` (existing code, Phase 02) |
| UPLOAD_SIZE_EXCEEDED | 400 | `size_bytes` is above `UPLOAD_MAX_SIZE_BYTES` (Hipótese) |
| PART_URLS_BATCH_TOO_LARGE | 400 | `part_numbers` has more than `PART_URLS_MAX_BATCH` items (Hipótese) |
| INVALID_PART_NUMBERS | 400 | `part_numbers` contains a number greater than the video's `part_count` (Hipótese) |
| VIDEO_NOT_FOUND | 404 | The video does not exist; or the caller is not the owner on an owner-only route; or the video is not `ready` and the caller is not the owner (per `phase-03-videos/TD-09` Revision; 404 chosen by the student, 2026-10-18) |
| CHANNEL_NOT_FOUND | 404 | The authenticated user has no channel (Hipótese; invariant of Phase 02) |
| VIDEO_NOT_IN_DRAFT | 409 | `part-urls` or `upload/parts` called after the upload was completed (Hipótese) |
| UPLOAD_INCOMPLETE | 409 | `complete` called while stored parts are fewer than `part_count` (Hipótese) |
| VIDEO_ALREADY_PROCESSED | 409 | `complete` called when `status` is `ready` or `failed` (Hipótese) |
| VIDEO_FILE_NOT_AVAILABLE | 409 | Owner asks `stream` or `download` for a video still in `draft` (Hipótese) |
| THUMBNAIL_NOT_AVAILABLE | 409 | `thumbnail_key` is null (Hipótese) |
| VIDEO_SIZE_MISMATCH | 422 | Stored size differs from `size_bytes` (Hipótese) |
| (throttler, no domain code) | 429 | A `videos` route exceeds its own `@Throttle` limit (`VIDEOS_THROTTLE_LIMIT` per `VIDEOS_THROTTLE_TTL_MS`) |
| (no code, existing 401) | 401 | Missing, invalid or expired access token; includes a token present but invalid on an `@OptionalAuth()` route (student decision, 2026-10-18) |

Worker-side failures are not HTTP errors. They end as `status = failed` with `failure_reason`; the classification (per `phase-03-videos/TD-11` Revision) is:

| Class | Examples | Behavior |
|-------|----------|----------|
| Non-retryable (`UnrecoverableError`) | corrupt or unsupported media (ffprobe/ffmpeg exit non-zero on a readable object), object missing in storage, video row missing | goes straight to `failed`, no retry |
| Retryable | storage or network error, Redis error, tool timeout | 3 attempts with exponential backoff, base 30s; `failed` only after the last attempt |

### Events/Messages

#### video.process (queue job)

Queue name `video-processing` (constant), job name `process-video`. The Redis key prefix comes from `QUEUE_PREFIX` (Hipótese: default `bull`, the BullMQ default); tests set their own prefix so a processor started inside a test never competes with the Compose `video-worker` for the same jobs. Whether the Nest module forwards `prefix` to both the Queue and the Worker is confirmed against the installed `@nestjs/bullmq` types in SI-03.7.

**Payload:**

```json
{ "videoId": "uuid" }
```

**Producer:** `VideosService` through the queue producer provider (per `phase-03-videos/TD-01`, `TD-05`)
**Consumer:** `VideoProcessor` in the worker process, started by `src/worker.ts` (per `phase-03-videos/TD-01`, `TD-06`)
**Trigger:** `POST /videos/:id/upload/complete` after the multipart upload is finalized and `status` is `processing`
**Job options:** `jobId = videoId` (duplicates are ignored by the queue), `attempts: 3`, `backoff: { type: 'exponential', delay: 30000 }` (per `phase-03-videos/TD-11` Revision; `VIDEO_JOB_ATTEMPTS` and `VIDEO_JOB_BACKOFF_MS` make them overridable in tests)
**Delivery semantics:** at-least-once (BullMQ); the consumer is idempotent: a video already `ready` is skipped, the thumbnail and metadata are overwritten on a rerun, and the same object keys are reused (per `phase-03-videos/TD-11`)
**Failure handling:** after the last attempt, or on `UnrecoverableError`, the consumer sets `status = failed` and `failure_reason`; the job stays in the queue as `failed` for inspection (per `phase-03-videos/TD-10`, `TD-11`)

**Processing steps (consumer):**
1. Load the video; if missing → `UnrecoverableError`; if `ready` → return (idempotent).
2. Presign a GET for `storage_key` with the internal endpoint client (the worker sits in the Compose network, per `phase-03-videos/TD-07`).
3. Run `ffprobe` (JSON) over the URL; map duration, container, codec, width, height, bitrate, fps and the raw JSON (per `phase-03-videos/TD-07` Revision).
4. Run `ffmpeg` to extract one frame at `max(1, duration × 0.1)` seconds, scaled to 640px wide, as JPEG (per `phase-03-videos/TD-07` Revision; for a clip shorter than 1s the offset is clamped to `0`: Hipótese). If the tool fails on the read, the per-job fallback of `TD-07` (download to temp, then process locally) is the safety net, not the default.
5. `PutObject` the JPEG at `thumbnails/{videoId}/default.jpg`.
6. Update the video: metadata, `thumbnail_key`, `status = ready`.

---

## Dependency Map

```
SI-03.1 (root) — repeatable migrations spec
└── SI-03.2 — lint baseline (needs a repeatable suite as its regression oracle)
    ├── SI-03.3 — Compose storage and redis, ffmpeg in the image
    │   └── SI-03.4 — dependencies, config namespaces, env validation
    │       ├── SI-03.5 — StorageModule (S3 clients, multipart, bucket bootstrap)
    │       │   └── SI-03.12 — media tools (ffprobe/ffmpeg over a presigned URL)
    │       └── SI-03.7 — queue producer
    └── SI-03.6 — Video entity, migration, test cleanup
SI-03.8 — POST /videos — depends on SI-03.5 + SI-03.6
└── SI-03.9 — POST part-urls
    ├── SI-03.10 — GET upload/parts
    │   └── SI-03.11 — POST complete — also depends on SI-03.7
    │       └── SI-03.13 — video processor — also depends on SI-03.7 + SI-03.12
    │           └── SI-03.14 — worker entrypoint and video-worker service
    └── SI-03.15 — GET /videos/:id and optional authentication
        └── SI-03.16 — GET stream
            ├── SI-03.17 — GET download
            └── SI-03.18 — GET thumbnail
SI-03.19 — e2e flow, OpenAPI export, 10GB smoke — depends on SI-03.11 + SI-03.14 + SI-03.18
└── SI-03.20 — CLAUDE.md update from the implemented code
```

SIs run one at a time, in numeric order (which respects every edge above); none runs in parallel. After each SI the relevant suite, `npx tsc --noEmit` and `npm run lint` must pass before the next one starts.

---

## Deliverables

- [ ] SI-03.1 — Make the migrations integration spec repeatable
- [ ] SI-03.2 — Repair the Phase 02 lint baseline
- [ ] SI-03.3 — Compose services for storage and queue, ffmpeg in the image
- [ ] SI-03.4 — Dependencies, configuration namespaces and env validation
- [ ] SI-03.5 — Storage module: S3 clients, multipart, presigning and idempotent bucket bootstrap
- [ ] SI-03.6 — Video entity, migration and test cleanup
- [ ] SI-03.7 — Video queue producer
- [ ] SI-03.8 — Endpoint POST /videos (initiate upload)
- [ ] SI-03.9 — Endpoint POST /videos/:id/upload/part-urls
- [ ] SI-03.10 — Endpoint GET /videos/:id/upload/parts
- [ ] SI-03.11 — Endpoint POST /videos/:id/upload/complete
- [ ] SI-03.12 — Media tools: ffprobe and ffmpeg over a presigned URL
- [ ] SI-03.13 — Video processor: metadata, thumbnail and failure policy
- [ ] SI-03.14 — Worker entrypoint and Compose service video-worker
- [x] SI-03.15 — Endpoint GET /videos/:id (with optional authentication)
- [x] SI-03.16 — Endpoint GET /videos/:id/stream
- [ ] SI-03.17 — Endpoint GET /videos/:id/download
- [ ] SI-03.18 — Endpoint GET /videos/:id/thumbnail
- [ ] SI-03.19 — End-to-end upload flow, OpenAPI export and 10GB smoke
- [ ] SI-03.20 — Update CLAUDE.md (root and nestjs-project) from the implemented code

**Phase documentation (required by the TD Revisions):**

- [ ] The MinIO → `pgsty/silo` substitution is recorded with the pinned tag in `compose.yaml` and in both `CLAUDE.md` files (`phase-03-videos/TD-03` Revision)
- [ ] The `S3_PUBLIC_ENDPOINT` exception to the "never `localhost`" rule is documented (`phase-03-videos/TD-04` Revision)
- [ ] `progress.md` records the manual 10GB sparse-file smoke with API latency during the upload (`phase-03-videos/TD-02` Revision)
- [ ] Known limitations are stated: abandoned drafts and orphan multipart uploads are not cleaned (follow-up for Phase 04), lifecycle `AbortIncompleteMultipartUpload` not applied, processing validated only for MP4/H.264 up to 2 GB in the spike

**Full test suites:**

- [ ] Backend tests pass (`cd nestjs-project && docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`cd nestjs-project && docker compose exec nestjs-api npm run test:e2e -- --runInBand`)
- [ ] Type check passes (`cd nestjs-project && docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes (`cd nestjs-project && docker compose exec nestjs-api npm run lint`)
- [ ] Project builds, including the worker entrypoint (`cd nestjs-project && docker compose exec nestjs-api npm run build`)
