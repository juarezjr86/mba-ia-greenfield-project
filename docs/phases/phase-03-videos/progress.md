# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 8/20 completed

### SI-03.1 — Make the migrations integration spec repeatable
- **Status:** completed
- **Tests:** 23 suites / 144 tests passing on two consecutive full runs (`npx jest --runInBand`, no `--forceExit`, same database, no schema reset between); `tsc --noEmit` exit 0
- **Observations:**
  - Baseline before the change (schema reset, then `jest --runInBand`): 23 suites / 144 tests green, but the run did not exit on its own and was killed after >10 min (an idle connection was left on `migrations`; cause not isolated, and a rerun with `--forceExit` was green). With the fix both runs finished and exited normally; whether the fix is what removed the hang is not proven (one sample each).
  - Helper `dropAllEnumTypes` (`src/test/create-test-data-source.ts`) drops every `typtype = 'e'` type in `public`; checked with an unlisted probe enum `zz_probe_enum`, removed by the spec run. After the spec, `migrations` holds 2 rows and `verification_tokens_type_enum` exists (fully migrated).
  - `nestjs-api` container idles with `tail -f /dev/null`; no dev server was started.

### SI-03.2 — Repair the Phase 02 lint baseline
- **Status:** completed
- **Tests:** no new tests (regression oracle): 23 suites / 144 tests passing (same as baseline) + e2e 3 suites / 52 tests passing; `tsc --noEmit` exit 0; `npm run lint` exit 0 (0 errors, 1 warning)
- **Observations:**
  - Lint baseline before the repair: 150 errors + 40 warnings. By rule (errors): no-unsafe-member-access 76, no-unsafe-assignment 41, unbound-method 19, no-unsafe-return 6, require-await 4, no-unused-vars 2, no-unsafe-call 1, no-unsafe-function-type 1; warnings: no-unsafe-argument 40. By file: `test/auth.e2e-spec.ts` 48, `auth.service.spec.ts` 45, `mail.service.integration-spec.ts` 16, `channels.service.spec.ts` 15, `auth.service.integration-spec.ts` 7, `domain-exception.filter.spec.ts` 7, `channels.service.ts` 6, others 1-2 each. Only `channels.service.ts` is production code.
  - Fixes are type-only: typed `PgErrorShape` in `isPgUniqueViolationOnColumn`; typed Mailpit helper (`MailpitMessageSummary/Detail`); `MockOf<T>`, `serviceMock`, `repoMock` in `auth.service.spec.ts` (replaces `jest.Mocked`, which triggers `unbound-method`); `bodyOf` and `getMailService` in the e2e spec; `createTestDataSource` takes `DataSourceOptions['entities']` instead of `Function`.
  - No `eslint-disable` added and `eslint.config.mjs` untouched. 1 `no-unsafe-argument` warning remains (`auth.service.integration-spec.ts:472`); the rule is configured as a warning, out of the SI's "zero errors" scope.
  - `npm run lint` runs with `--fix`; `git status` after it showed only the intended files.

### SI-03.3 — Compose services for storage and queue, ffmpeg in the image
- **Status:** completed
- **Tests:** no tests (Infra); regression check: 23 suites / 144 tests passing after the rebuild
- **Observations:**
  - Pinned tags: `pgsty/silo:RELEASE.2026-10-18T00-00-00Z` (newest non-distroless release on Docker Hub on 2026-10-18; the distroless variant was avoided to keep a shell in the container) and `redis:7.4.11` (assumption: no TD fixes the Redis version; BullMQ only needs `noeviction`). The tag used in the 2026-10-10 research spike is not recorded in the docs, so the spike evidence was not tied to this exact tag; the SI-03.5 smoke test against the real storage covers it.
  - Acceptance: `ffprobe`/`ffmpeg` 5.1.9 exit 0 inside `nestjs-api`; `redis-cli CONFIG GET maxmemory-policy` = `noeviction`; `curl http://storage:9000` returns HTTP 403 (S3 answers anonymous root with 403, not a connection error) and `/minio/health/live` returns 200; `docker compose -f compose.yaml config -q` exit 0 (works without `compose.override.yaml`); the `node_modules` volume survived the recreate of `nestjs-api`.
  - `S3_ACCESS_KEY` / `S3_SECRET_KEY` were added to `.env.example` and the local `.env` already in this SI because Compose interpolates them (`${VAR:?}` fails loudly when missing); the Joi validation and the config namespace stay in SI-03.4. Values are the local-dev placeholders `streamtube` / `streamtube-secret`.
  - `storage` has no healthcheck (`depends_on: service_started`): the image's tooling for a probe was not verified; `redis` has `redis-cli ping` and `service_healthy`.
  - Noticed, out of scope: `.env.example` has `MAIL_FROM="StreamTube" <noreply@streamtube.com>`, which breaks Compose parsing when copied as `.env` (known upstream issue, see `nestjs-project/CLAUDE.md` → Environment File Conventions); SI-03.4 touches `.env.example` and can quote it.

### SI-03.4 — Dependencies, configuration namespaces and env validation
- **Status:** completed
- **Tests:** `env.validation.integration-spec.ts` 14 passing (10 new); full suite 23 suites / 154 tests passing (144 + 10); e2e 3 suites / 52 tests passing; `tsc --noEmit` exit 0; `npm run lint` exit 0 (0 errors, 1 warning, same as before)
- **Observations:**
  - Installed `bullmq ^6.3.17`, `@nestjs/bullmq ^12.0.0`, `@aws-sdk/client-s3 ^3.1152.0`, `@aws-sdk/s3-request-presigner ^3.1152.0` (newer patch than the `library-refs.md` versions, same ranges). `@aws-sdk/lib-storage` is not in `package.json`. The Context7 re-check against the installed versions was not done here because this SI only installs; it is due in SI-03.5 (S3 commands) and SI-03.7 (queue), where the APIs are first called.
  - Created `storage.config.ts`, `queue.config.ts`, `videos.config.ts` (`registerAs` + `parseInt`, same shape as `auth.config.ts`), registered in `AppModule` `load`; Joi schema holds the same defaults and ranges (`UPLOAD_PART_SIZE_BYTES` 5242880..2147483647). Defaults for `S3_BUCKET`, `S3_CORS_ALLOWED_ORIGINS` and the videos limits are the plan's Hipótese values, kept configurable.
  - Acceptance: with all variables the app boots and `GET /` returns 200 (one-off `ts-node` bootstrap on port 3999, file removed afterwards, no dev server left running); with an empty `S3_ACCESS_KEY` bootstrap fails with `Config validation error: "S3_ACCESS_KEY" is not allowed to be empty`; `1048576` and `3000000000` are rejected (also `5242879`, `2147483648`), `5242880` and `2147483647` accepted; `compose.yaml` has no `localhost`, and `S3_PUBLIC_ENDPOINT` is the only host-address entry in the example env file.
  - `.env.example` (and the local `.env`) now list all new keys with Compose-network values; `MAIL_FROM` in `.env.example` was quoted (the SI-03.3 out-of-scope note), so a copy of the example no longer breaks Compose parsing.
  - Not committed: the commit authorization covered SI-03.1, SI-03.2 and (on request) SI-03.3 only.

### SI-03.5 — Storage module: S3 clients, multipart, presigning and idempotent bucket bootstrap
- **Status:** completed
- **Tests:** `src/storage` 3 suites / 20 tests passing (integration against the real `pgsty/silo`, unit, module), run without `--forceExit` and the process exits; full suite 26 suites / 174 tests passing (154 + 20); e2e 3 suites / 52 tests passing; `tsc --noEmit` exit 0; `npm run lint` exit 0 (0 errors, 1 warning, unchanged)
- **Observations:**
  - API source: the installed `@aws-sdk/client-s3@3.1152.0` `.d.ts` files (command inputs, `ListPartsOutput.NextPartNumberMarker: string`, `CORSRule`, `ResponseContentDisposition`), not Context7; the Context7 re-check promised in SI-03.4 was replaced by these type reads and by the real-storage tests.
  - **CORS on the pinned silo works:** `PutBucketCors` is accepted and `GetBucketCors` returns `ExposeHeaders` containing `ETag` and `PUT/GET/HEAD` (asserted in the integration spec, not just "did not throw"). The unverified-tag concern of SI-03.3 is covered for this tag.
  - **Checksum branch (action 4): not needed.** With SDK defaults the presigned `UploadPart` URL carries `x-amz-checksum-crc32` and `x-amz-sdk-checksum-algorithm` (query keys logged by the test: `X-Amz-Algorithm, X-Amz-Content-Sha256, X-Amz-Credential, X-Amz-Date, X-Amz-Expires, X-Amz-Signature, X-Amz-SignedHeaders, partNumber, uploadId, x-amz-checksum-crc32, x-amz-sdk-checksum-algorithm, x-id`), yet the silo accepted a raw `fetch` PUT of a real 5 MiB buffer (and a 1 KiB last part) with `200` and an `ETag`, so `requestChecksumCalculation: 'WHEN_REQUIRED'` was not set. Risk: the checksum value in the URL cannot match the real part bytes, so a stricter S3 (real AWS) would reject it; silo ignores it. Switching the option on both clients is a one-line change if the target storage ever changes.
  - Host-machine AC: URL produced by the public client (signed for `localhost:9000`) and fetched with `curl.exe -H "Range: bytes=0-99" "<url>"` from PowerShell answered `HTTP/1.1 206 Partial Content`, `Content-Length: 100`, `Content-Range: bytes 0-99/1000`.
  - `npm run storage:init` ran twice, both printed `Storage bucket and CORS are ready` (exit status verified through the printed message and `tail`, not `$?` of npm).
  - Design choices: `headObject` returns `null` on 404 (SI-03.11 needs to tell "object finalized by an earlier call" apart from an error) and rethrows everything else; `ensureBucket` treats only a 404 from `HeadBucket` as "absent" and tolerates `BucketAlreadyOwnedByYou`; `StorageService.onModuleDestroy` destroys both clients; `listAllParts` returns `{ partNumber, sizeBytes, etag }`; the integration spec overrides `storageConfig.KEY` (bucket `streamtube-test`, public endpoint `http://storage:9000`) instead of mutating `process.env`, and deletes its objects in `afterAll`.
  - Left behind in the dev bucket `streamtube`: object `smoke/host-curl.bin` (1000 bytes) from the host `curl` check; `StorageService` has no delete method, so it was not removed.
  - Not committed (commit authorization is per request).

### SI-03.6 — Video entity, migration and test cleanup
- **Status:** completed
- **Tests:** new/changed specs 3 suites (`video.entity.integration-spec.ts` 9, `videos.module.spec.ts` 1, `migrations.integration-spec.ts` 4); full suite 28 suites / 186 tests passing (174 + 12), run 3 times in a row starting from a virgin schema; e2e 3 suites / 52 tests passing; `tsc --noEmit` exit 0; `npm run lint` exit 0 (0 errors, 1 warning, unchanged); `npm run migration:run` reports no pending migrations; `npm run build` succeeds
- **Observations:**
  - Migration generated by the CLI: `1792365226864-CreateVideos.ts`; SQL reviewed (enum `videos_status_enum`, table with `CHK_` on `size_bytes > 0`, PK, index on `channel_id`, FK to `channels` with `NO ACTION`); `down` drops FK, index, table and the enum. File was formatted with Prettier before first use (never applied before that).
  - `id` uses `@PrimaryGeneratedColumn('uuid')` (project entity rule) so `VideosService` can still assign `crypto.randomUUID()` itself; the Data Model says the id is assigned by the service, and the DB default only covers rows created without one.
  - `Channel` gained `videos` (inverse side). Because `createTestDataSource` synchronizes the schema from the entity list, every `ALL_ENTITIES` array in the 10 existing suites that use it now includes `Video` (otherwise TypeORM cannot resolve `Channel#videos`).
  - `migrations.integration-spec.ts`: three migrations; the revert test now reverts only `CreateVideos` and checks that the table and `videos_status_enum` are gone, a new test applies it again, and the last test reverts down to the token tables. The drop of tables in `beforeAll` was `Promise.all`; with the `videos` → `channels` FK it deadlocked ("deadlock detected", first run failed, second passed), so it is now sequential (lesson L-20).
  - Acceptance: default `draft`; status `'bogus'` and `size_bytes` 0 rejected; FK blocks deleting a channel with videos and inserting a video of a missing channel; `10737418240` read back as the number `10737418240`; `bitrate`, `duration_seconds` (1500.123), `fps` (29.97) and `jsonb` round-trip; `cleanAllTables` empties `videos` first.
  - Incident: `npx prettier --write src` also reformatted `src/mail/templates/*.hbs`; both were reverted with `git checkout -- src/mail/templates` and later formatting was restricted to `*.ts`.
  - Not committed.

### SI-03.7 — Video queue producer
- **Status:** completed
- **Tests:** `src/queue` 2 suites / 6 tests passing (producer integration against the real Redis with a private prefix, module compile); full suite 30 suites / 192 tests passing (186 + 6), run twice, Jest exits on its own; e2e 3 suites / 52 tests passing; `tsc --noEmit` exit 0; `npm run lint` exit 0 (0 errors, 1 warning, unchanged); `npm run build` succeeds
- **Observations:**
  - Two blockers found by the first test run and decided by the student (option A on both, 2026-10-18), recorded as Revisions in `TD-01` and in `library-refs.md`: (1) `ioredis` was missing (`bullmq` 6.3.17 only lists it as an optional peer; the plan and `library-refs.md` never mentioned it) → installed `ioredis ^5.11.1`; 6.0.0 exists and was not tested. (2) `@nestjs/bullmq@12.0.0` is ESM-only and Jest 30 (CJS) failed with `SyntaxError: Unexpected token 'export'` → `transformIgnorePatterns` for `@nestjs/bullmq` and `@nestjs/bull-shared` plus a ts-jest `allowJs` transform for `.js`, in both `package.json` and `test/jest-e2e.json` (the latter needed later when `AppModule` imports `QueueModule`; it was changed now to keep both configs equal).
  - `prefix` reaches the Worker: read in `@nestjs/bullmq` `bull.explorer.js` / `bull.providers.js` (root `prefix` is forwarded to Queue, QueueEvents and the Worker of a `@Processor`), so SI-03.13 does not pass it explicitly.
  - Acceptance verified by the integration spec: job named `process-video`, data `{ videoId }`, id = `videoId`; `attempts` 3 and `{ type: 'exponential', delay: 30000 }` with the defaults; two enqueues of the same video leave one job; a queue with another prefix does not see the job; `queue.getWorkers()` is `[]`. The suite removes its data with `queue.obliterate({ force: true })`.
  - `QueueModule` exports the registered-queue dynamic module and `VideoQueueProducer`; it registers no `@Processor`. `VideosModule` does not import it yet (SI-03.11).
  - Process note: the first attempt to run the suite was interrupted by the user; the SI-03.6 commit (`5f1519f`) came right before. SI-03.7 is not committed.

### SI-03.8 — Endpoint POST /videos (initiate upload)
- **Status:** completed
- **Tests:** new: `upload-plan.util.spec.ts` 7, `video-naming.util.spec.ts` 10, `videos.service.spec.ts` 8, `videos.service.integration-spec.ts` 5 (real database and storage), `channels.service.integration-spec.ts` +2 (`findByUserId`), `test/videos-initiate-upload.e2e-spec.ts` 8 (authored from `specs/videos-initiate-upload.plan.md`); full suite 34 suites / 224 tests passing (192 + 32), run twice; e2e 4 suites / 60 tests passing with `--runInBand`; `tsc --noEmit` exit 0; `npm run lint` exit 0 (0 errors, 1 warning, unchanged); `npm run build` succeeds
- **Observations:**
  - Advisor consulted before implementing (project rule for risk SIs). Applied: the new integration and e2e specs use test buckets that do not exist on a fresh clone (`streamtube-test-videos`, `streamtube-test-e2e-videos`) and call `ensureBucket()` themselves, so they do not depend on a manual `storage:init` and do not write to the dev bucket; all writes inside `initiateUpload` go through the transaction `manager` (the "no row remains" test asserts `count() === 0` on the real database); `ChannelsService` constructor untouched (`findByUserId` uses `dataSource.getRepository`); the response is mapped explicitly (no `upload_id` / `storage_key`); a shared e2e helper `test/helpers/videos-e2e.ts` (`bodyOf`, `createVideosTestApp`, `registerConfirmedUser`) is for the next 7 videos e2e specs, `auth.e2e-spec.ts` left alone.
  - Throttle: `@Throttle` is at class level with `{ default: { limit: () => videosConfig().throttleLimit, ttl: () => videosConfig().throttleTtlMs } }`. Confirmed in the installed `@nestjs/throttler`: `limit`/`ttl` are `Resolvable<number>` (a function is allowed), `forRoot([{ ttl, limit }])` names the throttler `default`, and the functions run per request, after `.env` is loaded into `process.env`. The 429 body is the throttler's own (not `ApiErrorEnvelope`); it is documented as such in `@ApiResponse(429)`.
  - Edge handled in `computeUploadPlan`: rounding a configured part size of `2147483647` up to a whole MiB would overflow the `integer` column, so the result is capped at `2147483647` (then not a MiB multiple; S3 only needs >= 5 MiB for non-last parts). With the defaults this never happens (64 MiB, 160 parts for 10 GiB).
  - Ordering in the service: size check, then channel lookup, then the transaction (insert draft, `createMultipartUpload`, update `upload_id` and plan). If storage succeeds and the commit then fails, a multipart upload stays orphaned in storage; accepted by TD-05 (no cleanup in Phase 03), same as abandoned drafts.
  - Not covered by this SI: nothing calls `ensureBucket()` at application start; the bucket still has to be created with `npm run storage:init` before the first real upload (SI-03.14 / SI-03.19 may wire it in).
  - `npm run test:e2e` without `--runInBand` runs the suites in parallel and failed (9 tests, `auth` and `videos-initiate-upload` contaminating each other through the shared database); with `--runInBand`, as the project rule and the Deliverables require, it passes.
  - Not committed.

### SI-03.9 — Endpoint POST /videos/:id/upload/part-urls
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.10 — Endpoint GET /videos/:id/upload/parts
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.11 — Endpoint POST /videos/:id/upload/complete
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.12 — Media tools: ffprobe and ffmpeg over a presigned URL
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.13 — Video processor: metadata, thumbnail and failure policy
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.14 — Worker entrypoint and Compose service video-worker
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.15 — Endpoint GET /videos/:id (with optional authentication)
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.16 — Endpoint GET /videos/:id/stream
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.17 — Endpoint GET /videos/:id/download
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.18 — Endpoint GET /videos/:id/thumbnail
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.19 — End-to-end upload flow, OpenAPI export and 10GB smoke
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.20 — Update CLAUDE.md (root and nestjs-project) from the implemented code
- **Status:** pending
- **Tests:** -
- **Observations:** none
