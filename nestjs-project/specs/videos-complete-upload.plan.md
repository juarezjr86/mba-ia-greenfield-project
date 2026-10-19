---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.11
target_file: nestjs-project/test/videos-complete-upload.e2e-spec.ts
---

# POST /videos/:id/upload/complete Test Plan

## Application Overview

Finalizes the multipart upload, confirms the stored size, moves the video to `processing` and enqueues one job whose id is the video id. The call is idempotent: a retry while `processing` only re-enqueues (the fixed `jobId` prevents a second job), and a storage object finalized by an earlier failed call is recovered.

## Test Scenarios

### 1. Complete upload

**Setup:** `beforeAll` bootstraps `AppModule` with the `main.ts` global config (`ValidationPipe`, `DomainExceptionFilter`, `ValidationExceptionFilter`). `S3_PUBLIC_ENDPOINT` is set to the internal storage address (`http://storage:9000`), because a URL signed for the host-published address is unreachable from inside the `nestjs-api` container (Hipótese, per SI-03.4), and `QUEUE_PREFIX` is private to the test so the Compose `video-worker` never consumes its jobs. `beforeEach` runs `cleanAllTables`, clears the throttler storage and empties the video queue (private Redis prefix). Real database, real storage and real Redis. Two confirmed users with channels and tokens; the first one initiates a draft with `POST /videos` whose `size_bytes` equals two 5 MiB parts plus a short last part, and sends the parts straight to storage through `POST .../part-urls`.

#### 1.1. complete-moves-video-to-processing

**Covers AC:** #1, #2
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. POST /videos/:id/upload/complete as the owner after all parts were stored
    - expect: status 202 and body `{ id, status: "processing" }`
    - expect: the object exists in storage with the declared size
    - expect: the `videos` row has `status` `processing` and `upload_id` null
    - expect: the queue holds one job whose id is the video id

#### 1.2. repeated-complete-does-not-create-a-second-job

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. POST complete twice in a row as the owner
    - expect: both calls answer 202
    - expect: the queue still holds exactly one job for the video id
  2. POST complete twice in parallel on another fresh video
    - expect: both calls succeed and one job exists

#### 1.3. missing-parts-keep-draft

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. Send only part 1, then POST complete as the owner
    - expect: status 409 and `error: "UPLOAD_INCOMPLETE"`
    - expect: the video stays `draft`

#### 1.4. size-mismatch-keeps-draft

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. Send all parts but with a last part whose size makes the sum differ from `size_bytes`, then POST complete
    - expect: status 422 and `error: "VIDEO_SIZE_MISMATCH"`
    - expect: the video stays `draft`

#### 1.5. ready-or-failed-video-is-already-processed

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. Set the video row to `ready`, then POST complete as the owner
    - expect: status 409 and `error: "VIDEO_ALREADY_PROCESSED"`
  2. Set the video row to `failed`, then POST complete as the owner
    - expect: status 409 and `error: "VIDEO_ALREADY_PROCESSED"`

#### 1.6. object-finalized-by-an-earlier-failed-call-is-recovered

**Covers AC:** #7
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. Finalize the multipart upload directly in storage (as an earlier call that failed before the database update would have), leaving the row `draft` with `upload_id` set, then POST complete as the owner
    - expect: status 202
    - expect: the video ends `processing` with exactly one job

#### 1.7. other-owner-unknown-id-and-no-token

**Covers AC:** #8
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. POST complete as the second user
    - expect: status 404
  2. POST complete with a well-formed uuid that does not exist
    - expect: status 404
  3. POST complete without an `Authorization` header
    - expect: status 401
