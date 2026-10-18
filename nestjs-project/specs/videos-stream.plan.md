---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.16
target_file: nestjs-project/test/videos-stream.e2e-spec.ts
---

# GET /videos/:id/stream Test Plan

## Application Overview

Returns `{ url, expires_in }` with a short-lived presigned GET URL, so the player reads the file straight from storage and seeks with `Range` requests answered `206`. Access: the owner sees any status except `draft`; everyone else only `ready`. The route is `@Public()` with `@OptionalAuth()`.

## Test Scenarios

### 1. Stream URL

**Setup:** `beforeAll` bootstraps `AppModule` with the `main.ts` global config (`ValidationPipe`, `DomainExceptionFilter`, `ValidationExceptionFilter`). `S3_PUBLIC_ENDPOINT` is set to the internal storage address (`http://storage:9000`), because a URL signed for the host-published address is unreachable from inside the `nestjs-api` container (Hipótese, per SI-03.4). `beforeEach` runs `cleanAllTables` and clears the throttler storage. Real database and real storage. Two confirmed users with channels and tokens; a `ready` video, a `processing` video and a `draft` video are inserted for the first user's channel, the first two with a real object uploaded at their `storage_key` (at least 100 bytes).

#### 1.1. ready-video-returns-presigned-url

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. GET /videos/:id/stream for the `ready` video without a token
    - expect: status 200
    - expect: body has `url` and `expires_in`

#### 1.2. returned-url-answers-range-requests-with-206

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. GET the returned `url` directly in storage with header `Range: bytes=0-99`
    - expect: status 206
    - expect: a `Content-Range` header is present
    - expect: the body has 100 bytes

#### 1.3. owner-access-by-status

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. GET /videos/:id/stream for the `processing` video as the owner
    - expect: status 200
  2. GET /videos/:id/stream for the `draft` video as the owner
    - expect: status 409 and `error: "VIDEO_FILE_NOT_AVAILABLE"`

#### 1.4. non-ready-video-is-hidden-from-others

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. GET /videos/:id/stream for the `processing` video as the second user
    - expect: status 404 and `error: "VIDEO_NOT_FOUND"`
  2. GET the same route without a token
    - expect: status 404 and `error: "VIDEO_NOT_FOUND"`

#### 1.5. invalid-token-is-unauthorized

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. GET /videos/:id/stream for the `ready` video with `Authorization: Bearer not-a-token`
    - expect: status 401
