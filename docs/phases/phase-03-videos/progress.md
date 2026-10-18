# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 4/20 completed

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
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.6 — Video entity, migration and test cleanup
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.7 — Video queue producer
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.8 — Endpoint POST /videos (initiate upload)
- **Status:** pending
- **Tests:** -
- **Observations:** none

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
