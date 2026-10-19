---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.15
target_file: nestjs-project/test/videos-get.e2e-spec.ts
---

# GET /videos/:id Test Plan

## Application Overview

The unique URL of a video returns its metadata and status. The route is `@Public()` with the opt-in `@OptionalAuth()`: no `Authorization` header is anonymous, a valid token identifies the caller, and a token that is present but invalid or expired is a 401. The owner sees any status; everyone else only `ready`, and a hidden video answers 404. `ffprobe_metadata`, `upload_id` and `storage_key` are never exposed, and `failure_reason` is visible only to the owner.

## Test Scenarios

### 1. Read a video

**Setup:** `beforeAll` bootstraps `AppModule` with the `main.ts` global config (`ValidationPipe`, `DomainExceptionFilter`, `ValidationExceptionFilter`). `beforeEach` runs `cleanAllTables` and clears the throttler storage. Real database. Two confirmed users with channels and tokens; videos are inserted directly in the database for the first user's channel with each status (`draft`, `processing`, `ready`, `failed`), the `failed` one with a `failure_reason` and the `ready` one with `ffprobe_metadata`.

#### 1.1. ready-video-is-public-and-hides-internal-fields

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. GET /videos/:id for the `ready` video without a token
    - expect: status 200 with the video metadata
    - expect: the body has none of `ffprobe_metadata`, `upload_id` or `storage_key`

#### 1.2. owner-reads-any-status-and-sees-failure-reason

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. GET /videos/:id as the owner for the `draft`, `processing` and `failed` videos
    - expect: status 200 for each
    - expect: `failure_reason` appears for the `failed` video
  2. GET /videos/:id for the `ready` video as another user
    - expect: status 200 and `failure_reason` is null

#### 1.3. non-ready-video-is-hidden-from-others

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. GET /videos/:id for the `draft`, `processing` and `failed` videos as the second user
    - expect: status 404 and `error: "VIDEO_NOT_FOUND"` for each
  2. Repeat the same three requests without a token
    - expect: status 404 and `error: "VIDEO_NOT_FOUND"` for each

#### 1.4. invalid-or-expired-token-is-unauthorized

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. GET /videos/:id for the `ready` video with `Authorization: Bearer not-a-token`
    - expect: status 401
  2. GET the same route with an expired access token
    - expect: status 401

#### 1.5. non-uuid-id-is-a-validation-error

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. GET /videos/not-a-uuid
    - expect: status 400 and `error: "VALIDATION_ERROR"`

#### 1.6. phase-02-routes-keep-their-behavior

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-10-18T21:52:43Z

**Steps:**
  1. Call an existing public route of Phase 02 (for example `POST /auth/login` with invalid credentials) without a token
    - expect: the route answers without requiring authentication (not 401 for a missing token)
  2. Call a protected route of Phase 02 (for example `GET /auth/me`) without a token
    - expect: status 401
