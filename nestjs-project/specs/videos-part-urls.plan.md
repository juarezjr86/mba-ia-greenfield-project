---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.9
target_file: nestjs-project/test/videos-part-urls.e2e-spec.ts
---

# POST /videos/:id/upload/part-urls Test Plan

## Application Overview

Gives the owner of a `draft` video a batch of presigned `UploadPart` URLs, signed for the public storage endpoint, so each part is sent straight to storage. Another user's video is hidden as not found, and a video that left `draft` answers a conflict.

## Test Scenarios

### 1. Part URLs

**Setup:** `beforeAll` bootstraps `AppModule` with the `main.ts` global config (`ValidationPipe`, `DomainExceptionFilter`, `ValidationExceptionFilter`). `S3_PUBLIC_ENDPOINT` is set to the internal storage address (`http://storage:9000`), because a URL signed for the host-published address is unreachable from inside the `nestjs-api` container (Hipótese, per SI-03.4), and `QUEUE_PREFIX` is private to the test so the Compose `video-worker` never consumes its jobs. `beforeEach` runs `cleanAllTables` and clears the throttler storage. Real database, real storage and real Redis. Two confirmed users with channels and tokens; the first one initiates a draft with `POST /videos` (`size_bytes` large enough for at least 2 parts).

#### 1.1. owner-gets-presigned-urls

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. POST /videos/:id/upload/part-urls as the owner with `{ part_numbers: [1, 2] }`
    - expect: status 200
    - expect: body has two `{ part_number, url }` entries and `expires_in`

#### 1.2. returned-url-accepts-direct-put

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. Request the URL of part 1, then send a 5 MiB body with `PUT` straight to that URL (not through the API)
    - expect: storage answers 2xx
    - expect: the response carries an `ETag` header

#### 1.3. invalid-part-numbers-are-rejected

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. POST part-urls with a part number above the video's `part_count`
    - expect: status 400 and `error: "INVALID_PART_NUMBERS"`
  2. POST part-urls with more than `PART_URLS_MAX_BATCH` part numbers
    - expect: status 400 and `error: "PART_URLS_BATCH_TOO_LARGE"`

#### 1.4. other-owner-or-unknown-id-is-not-found

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. POST part-urls for the draft as the second user
    - expect: status 404 and `error: "VIDEO_NOT_FOUND"`
  2. POST part-urls with a well-formed uuid that does not exist
    - expect: status 404 and `error: "VIDEO_NOT_FOUND"`

#### 1.5. video-not-in-draft-is-a-conflict

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. Move the video to `processing` (complete its upload or update the row), then POST part-urls as the owner
    - expect: status 409 and `error: "VIDEO_NOT_IN_DRAFT"`

#### 1.6. request-without-token-is-unauthorized

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. POST part-urls without an `Authorization` header
    - expect: status 401
