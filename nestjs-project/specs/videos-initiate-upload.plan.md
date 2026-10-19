---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.8
target_file: nestjs-project/test/videos-initiate-upload.e2e-spec.ts
---

# POST /videos (initiate upload) Test Plan

## Application Overview

Creates the draft video and its S3 multipart upload in one step and returns `id`, `status`, `part_size_bytes` and `part_count`, so the client can slice the file and send the parts straight to storage. The route is authenticated, carries its own `@Throttle` read from `videosConfig`, and must leave no `videos` row behind when storage fails.

## Test Scenarios

### 1. Initiate upload

**Setup:** `beforeAll` bootstraps `AppModule` with the `main.ts` global config (`ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, `transform`; `DomainExceptionFilter`; `ValidationExceptionFilter`). `beforeEach` runs `cleanAllTables` and clears the throttler storage. Real database, real storage (Compose service) and real Redis. A confirmed user with its channel and an access token is created through the Phase 02 endpoints.

#### 1.1. initiate-valid-request-creates-draft

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. POST /videos with a valid token and body `{ filename: "aula.mp4", size_bytes: 12582912, content_type: "video/mp4" }`
    - expect: status 201
    - expect: body has `id` (uuid), `status: "draft"`, `part_size_bytes` and `part_count`
    - expect: the `videos` row exists with the caller's `channel_id` and a non-null `upload_id`

#### 1.2. title-defaults-to-filename-without-extension

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. POST /videos with a valid token and a body without `title`, `filename: "Aula 01.mp4"`
    - expect: status 201
    - expect: the stored `title` is `Aula 01`

#### 1.3. size-above-maximum-is-rejected

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. POST /videos with `size_bytes` equal to `UPLOAD_MAX_SIZE_BYTES + 1`
    - expect: status 400
    - expect: body `error` is `UPLOAD_SIZE_EXCEEDED`
    - expect: no `videos` row was created

#### 1.4. invalid-content-type-is-rejected

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. POST /videos with `content_type: "image/png"`
    - expect: status 400 and `error: "VALIDATION_ERROR"`
  2. POST /videos with a `content_type` of 128 characters starting with `video/`
    - expect: status 400 and `error: "VALIDATION_ERROR"`

#### 1.5. request-without-token-is-unauthorized

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. POST /videos without an `Authorization` header
    - expect: status 401

#### 1.6. ten-gib-file-respects-multipart-limits

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. POST /videos with `size_bytes` of 10 GiB (10737418240)
    - expect: status 201
    - expect: `part_count` is at most 10000
    - expect: `part_size_bytes` is at least 5 MiB (5242880)

#### 1.7. storage-failure-leaves-no-draft

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. Make `StorageService.createMultipartUpload` reject (failure injection on the real provider instance), then POST /videos with a valid body
    - expect: the response is an error status (not 201)
    - expect: the `videos` table has zero rows

#### 1.8. throttle-is-independent-of-global-limit

**Covers AC:** #7
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. Send 11 valid POST /videos calls within one minute from the same client
    - expect: none of the responses is 429
  2. GET the OpenAPI document of the application
    - expect: the `POST /videos` operation documents a `429` response
