---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.10
target_file: nestjs-project/test/videos-list-parts.e2e-spec.ts
---

# GET /videos/:id/upload/parts Test Plan

## Application Overview

Lets an interrupted client resume: the owner of a `draft` video lists the parts storage already holds (`ListParts`), ordered by part number. There is no abort endpoint; an upload that is never completed stays `draft`.

## Test Scenarios

### 1. List uploaded parts

**Setup:** `beforeAll` bootstraps `AppModule` with the `main.ts` global config (`ValidationPipe`, `DomainExceptionFilter`, `ValidationExceptionFilter`). `S3_PUBLIC_ENDPOINT` is set to the internal storage address (`http://storage:9000`), because a URL signed for the host-published address is unreachable from inside the `nestjs-api` container (Hipótese, per SI-03.4). `beforeEach` runs `cleanAllTables` and clears the throttler storage. Real database, real storage and real Redis. Two confirmed users with channels and tokens; the first one initiates a draft with `POST /videos` and has presigned part URLs available through `POST /videos/:id/upload/part-urls`.

#### 1.1. lists-parts-sent-straight-to-storage

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. Send parts 2 and 1 (in this order) with `PUT` to their presigned URLs, then GET /videos/:id/upload/parts as the owner
    - expect: status 200
    - expect: `parts` has both entries ordered by `part_number` (1 then 2)
    - expect: each entry has `size_bytes` and `etag`

#### 1.2. no-part-sent-returns-empty-list

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. GET /videos/:id/upload/parts as the owner of a fresh draft
    - expect: status 200
    - expect: `parts` is an empty array

#### 1.3. other-owner-or-unknown-id-is-not-found

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. GET /videos/:id/upload/parts as the second user
    - expect: status 404 and `error: "VIDEO_NOT_FOUND"`
  2. GET with a well-formed uuid that does not exist
    - expect: status 404 and `error: "VIDEO_NOT_FOUND"`

#### 1.4. video-not-in-draft-is-a-conflict

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. Move the video to `processing`, then GET /videos/:id/upload/parts as the owner
    - expect: status 409 and `error: "VIDEO_NOT_IN_DRAFT"`

#### 1.5. request-without-token-is-unauthorized

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. GET /videos/:id/upload/parts without an `Authorization` header
    - expect: status 401
