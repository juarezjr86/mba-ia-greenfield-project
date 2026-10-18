# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 2/20 completed

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
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.4 — Dependencies, configuration namespaces and env validation
- **Status:** pending
- **Tests:** -
- **Observations:** none

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
