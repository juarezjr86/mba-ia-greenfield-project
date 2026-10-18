# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 1/20 completed

### SI-03.1 — Make the migrations integration spec repeatable
- **Status:** completed
- **Tests:** 23 suites / 144 tests passing on two consecutive full runs (`npx jest --runInBand`, no `--forceExit`, same database, no schema reset between); `tsc --noEmit` exit 0
- **Observations:**
  - Baseline before the change (schema reset, then `jest --runInBand`): 23 suites / 144 tests green, but the run did not exit on its own and was killed after >10 min (an idle connection was left on `migrations`; cause not isolated, and a rerun with `--forceExit` was green). With the fix both runs finished and exited normally; whether the fix is what removed the hang is not proven (one sample each).
  - Helper `dropAllEnumTypes` (`src/test/create-test-data-source.ts`) drops every `typtype = 'e'` type in `public`; checked with an unlisted probe enum `zz_probe_enum`, removed by the spec run. After the spec, `migrations` holds 2 rows and `verification_tokens_type_enum` exists (fully migrated).
  - `nestjs-api` container idles with `tail -f /dev/null`; no dev server was started.

### SI-03.2 — Repair the Phase 02 lint baseline
- **Status:** pending
- **Tests:** -
- **Observations:** none

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
