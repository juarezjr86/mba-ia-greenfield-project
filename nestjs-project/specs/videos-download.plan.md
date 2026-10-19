---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.17
target_file: nestjs-project/test/videos-download.e2e-spec.ts
---

# GET /videos/:id/download Test Plan

## Application Overview

Same mechanism as streaming, with the content-disposition signed into the URL so the browser saves the file under its original name. The response is `{ url, expires_in, filename }`. Accented names are delivered through `filename*`.

## Test Scenarios

### 1. Download URL

**Setup:** `beforeAll` bootstraps `AppModule` with the `main.ts` global config (`ValidationPipe`, `DomainExceptionFilter`, `ValidationExceptionFilter`). `S3_PUBLIC_ENDPOINT` is set to the internal storage address (`http://storage:9000`), because a URL signed for the host-published address is unreachable from inside the `nestjs-api` container (Hipótese, per SI-03.4). `beforeEach` runs `cleanAllTables` and clears the throttler storage. Real database and real storage. Two confirmed users with channels and tokens; a `ready` video with `original_filename` `aula.mp4`, a `ready` video with `original_filename` `Vídeo ação.mp4`, a `processing` video and a `draft` video are inserted for the first user's channel, the non-draft ones with a real object at their `storage_key`.

#### 1.1. ready-video-returns-url-and-filename

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. GET /videos/:id/download for the `ready` video `aula.mp4` without a token
    - expect: status 200
    - expect: body has `url`, `expires_in` and `filename` equal to `aula.mp4`

#### 1.2. url-answers-content-disposition-attachment

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. GET the returned `url` directly in storage
    - expect: the `Content-Disposition` header starts with `attachment`
    - expect: the header carries the file name `aula.mp4`

#### 1.3. accented-filename-is-preserved

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. GET /videos/:id/download for the `Vídeo ação.mp4` video, then GET the returned `url` directly in storage
    - expect: the `Content-Disposition` header contains `filename*=UTF-8''` with the percent-encoded accented name
    - expect: the decoded name equals `Vídeo ação.mp4`

#### 1.4. draft-and-hidden-videos

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. GET /videos/:id/download for the `draft` video as the owner
    - expect: status 409 and `error: "VIDEO_FILE_NOT_AVAILABLE"`
  2. GET /videos/:id/download for the `processing` video as the second user, then without a token
    - expect: status 404 and `error: "VIDEO_NOT_FOUND"` in both cases
