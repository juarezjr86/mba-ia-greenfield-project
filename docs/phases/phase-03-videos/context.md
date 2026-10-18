---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-10-10T21:16:34-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-18T18:00:03-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-10-10T21:22:03-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-10-10T21:22:03-03:00"
  docs/phases/phase-02-auth/context.md: "2026-10-10T21:22:03-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-10-10T21:22:03-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-10-10T21:16:33-03:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Upload e Processamento de Vídeos

**Capabilities** (literal, `docs/project-plan.md`):

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** _Not specified._
**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.
**Affected subprojects:**

- No subproject is named in the Phase 03 block of `docs/project-plan.md`. Its only scoping text is "Depende de: Fase 01, Fase 02" and "Upload de arquivos grandes sem travar o sistema, processamento automático do vídeo e geração de URL única."

**Deferred subprojects:** _None._
**Sequencing notes:** "Depende de: Fase 01, Fase 02". Phase 04 declares "Depende de: Fase 02, Fase 03".

**Neighbors (for boundary detection only):**

- **Phase 02:** Fluxo completo de criação de conta, confirmação por e-mail, login, logout e recuperação de senha.
- **Phase 04:** Edição das informações do vídeo, fluxo de rascunho e publicação, painel de administração do canal e página pública.

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | phase | Backend | Queue Technology | decided | A (BullMQ on Redis) | bullmq, @nestjs/bullmq |
| phase-03-videos/TD-02 | phase | Cross-layer | Upload Strategy for Files up to 10GB | decided | A (S3 multipart, per-part presigned URLs) | — |
|     └─ Last revision: 2026-10-18 — No abort endpoint: Phase 03 exposes initiate, part-urls, parts (resume via List… | | | | | | |
| phase-03-videos/TD-03 | phase | Repo-wide | Local S3-Compatible Server Image | decided | A (pgsty/silo, tag pinned) | — |
|     └─ Last revision: 2026-10-10 — Substitution MinIO to pgsty/silo is recorded in the plan Deliverables, in a com… | | | | | | |
| phase-03-videos/TD-04 | phase | Backend | Storage Access: SDK, Endpoint Topology and Bucket Layout | decided | A (AWS SDK v3, one bucket with key prefixes) | @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, @aws-sdk/lib-storage |
|     └─ Last revision: 2026-10-18 — Libraries: @aws-sdk/lib-storage dropped; the phase installs @aws-sdk/client-s3 … | | | | | | |
| phase-03-videos/TD-05 | phase | Cross-layer | Upload Completion Signal and Job Enqueue Trigger | decided | A (explicit complete call to the API) | — |
|     └─ Last revision: 2026-10-18 — Abort deliberately not offered (student decision): the only ways out of draft a… | | | | | | |
| phase-03-videos/TD-06 | phase | Repo-wide | Worker Topology and Runtime Image | decided | C (same image, separate Compose service) | — |
| phase-03-videos/TD-07 | phase | Backend | Media Processing: ffprobe/ffmpeg Invocation | decided | A (spawn over presigned GET URL; per-job fallback to B) | — |
|     └─ Last revision: 2026-10-10 — OQ-1 closed: the spike evidence above is accepted as sufficient to keep Option… | | | | | | |
| phase-03-videos/TD-08 | phase | Cross-layer | Unique Video Identifier and URL Shape | decided | A (existing UUID PK as public identifier) | — |
| phase-03-videos/TD-09 | phase | Cross-layer | Streaming and Download Delivery | decided | A (API authorizes, returns short-lived presigned GET URL) | — |
|     └─ Last revision: 2026-10-18 — Access rule refined for the public GET routes (student decision; refines the 20… | | | | | | |
| phase-03-videos/TD-10 | phase | Backend | Video Status Model | decided | A (enum draft -> processing -> ready or failed) | — |
|     └─ Last revision: 2026-10-10 — Keep the name draft (OQ-3 of the research); Phase 04 decides whether publicatio… | | | | | | |
| phase-03-videos/TD-11 | phase | Backend | Failure, Retry and Idempotency Policy | decided | A (queue-native retries, terminal failed, idempotent worker) | — |
|     └─ Last revision: 2026-10-10 — Parameters (AMB-4): 3 attempts with exponential backoff, base 30s; corrupt or n… | | | | | | |
| phase-03-videos/TD-12 | phase | Backend | Test Strategy for the Async Pipeline | decided | A (real storage + queue + ffmpeg, tests in nestjs-api) | — |
|     └─ Last revision: 2026-10-18 — Baseline SI naming: the "SI-03.0" above is split into SI-03.1 (migrations spe… | | | | | | |

_Source files:_

- phase-03-videos — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase, related_phases: [3])

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-03, phase-03-videos/TD-04 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01, phase-03-videos/TD-06, phase-03-videos/TD-12 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02, phase-03-videos/TD-12 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-02, phase-03-videos/TD-10 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-05, phase-03-videos/TD-06, phase-03-videos/TD-07, phase-03-videos/TD-10, phase-03-videos/TD-11, phase-03-videos/TD-12 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-07, phase-03-videos/TD-11, phase-03-videos/TD-12 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-08 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-04, phase-03-videos/TD-09 |
| Download do vídeo pelo usuário | phase-03-videos/TD-09 |

## Decisions Detail

_(current-phase TDs only — from decisions-detail-reader)_

### phase-03-videos/TD-01

**Recommendation:** it is the shortest path with first-party NestJS support and keeps the queue a real, separate Compose service, which is what the acceptance criteria text expects. The cost is one extra Redis container and a dual write that TD-11 must make idempotent. If minimizing infrastructure outweighs the "visible queue service" expectation, Option C is the strongest alternative because of the shared-transaction potential.
**Libraries:** bullmq, @nestjs/bullmq

### phase-03-videos/TD-02

**Recommendation:** it satisfies "not through the API" with the storage's own protocol and no extra service, and the spike confirmed the flow against the candidate server. Option B is the better choice if client-side resumability and a standard client library matter more than keeping the component count low.
**Libraries:** —

**Revisions:**
- 2026-10-10 — Acceptance criterion for "no performance impact" (AMB-1): zero bytes of the file pass through the API, proven by an integration test that sends parts straight to storage, plus a manual smoke with a 10GB sparse file recorded in progress.md showing the API stays responsive during the upload. _Rationale:_ structural criterion plus manual smoke (student choice).
- 2026-10-10 — Ownership and initiation payload (AMB-3): the video belongs to the channel (FK channel_id, derived from the authenticated user 1:1 channel); initiation receives filename, size in bytes and content type; the title is optional and defaults to the filename without extension. _Rationale:_ channel as owner aligns with the Phase 04 channel management.
- 2026-10-18 — No abort endpoint: Phase 03 exposes initiate, part-urls, parts (resume via ListParts) and complete only; AbortMultipartUpload is not offered to the client. An upload that is never completed stays in draft and its multipart upload stays open in storage. _Rationale:_ student decision; cleanup of drafts and orphan multipart uploads is a follow-up for Phase 04 (see TD-05 Revisions).

### phase-03-videos/TD-03

**Recommendation:** it is the only candidate whose required behaviors (multipart with presigned parts, Range/206, content-disposition, CORS) were observed working, and it keeps the "MinIO in Docker" mental model of the challenge. Whatever is chosen, the image tag must be pinned in `compose.yaml` and the divergence from "MinIO" recorded in the phase documentation.
**Libraries:** —

**Revisions:**
- 2026-10-10 — Lifecycle rule AbortIncompleteMultipartUpload is not applied (OQ-1 of the research): abandoned multipart uploads are not cleaned automatically in the local storage. _Rationale:_ known limitation, no capability requires it; cleanup is out of scope (see TD-05).
- 2026-10-10 — Substitution MinIO to pgsty/silo is recorded in the plan Deliverables, in a comment of compose.yaml with the pinned image tag, and in the final CLAUDE.md update (OQ-5 of the research). _Rationale:_ documentation consistency with the enunciado.

### phase-03-videos/TD-04

**Recommendation:** it uses the S3 contract the challenge says production will use and was exercised end to end in the spike. Separate buckets (B) become attractive only if Phase 04/05 needs anonymous-readable thumbnails with private videos.
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, @aws-sdk/lib-storage

**Revisions:**
- 2026-10-10 — Public endpoint (ICC-1): presigned URLs for the client use a separate env value (S3_PUBLIC_ENDPOINT), the only place where the host-published address is accepted; the rule of never using localhost keeps applying to service-to-service calls. Recorded in the phase documentation. _Rationale:_ reaffirm the exception and document it.
- 2026-10-10 — Single PUT cap confirmed in the official AWS docs (OQ-4 of the research): a single PUT uploads up to 5 GB (docs.aws.amazon.com/AmazonS3/latest/userguide/upload-objects.html); multipart parts are 5 MiB to 5 GiB, up to 10,000 parts (docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html). _Rationale:_ justifies excluding a single presigned PUT.
- 2026-10-18 — Libraries: @aws-sdk/lib-storage dropped; the phase installs @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner (with bullmq and @nestjs/bullmq from TD-01). _Rationale:_ upload is multipart with per-part presigned URLs sent straight from the client to storage, so no capability uses Upload; the Libraries line above still lists it and is superseded by this Revision.

### phase-03-videos/TD-05

**Recommendation:** explicit, testable and independent of the storage vendor's event mechanism (which the TD-03 candidates do not share). Option B can be layered later as a safety net.
**Libraries:** —

**Revisions:**
- 2026-10-10 — Cleanup of abandoned drafts and orphan multipart uploads is out of Phase 03 (OQ-2 of the research); uploads never completed stay in draft; follow-up for Phase 04. _Rationale:_ no capability of the phase requires it.
- 2026-10-18 — Abort deliberately not offered (student decision): the only ways out of draft are the explicit complete call or the Phase 04 cleanup follow-up. _Rationale:_ keeps the completion signal single-path; complements the entry above.

### phase-03-videos/TD-06

**Recommendation:** the project has only a development image, and a single image keeps the whole test suite runnable through the existing `docker compose exec nestjs-api` workflow. Option A becomes preferable once a production Dockerfile exists.
**Libraries:** —

### phase-03-videos/TD-07

**Recommendation:** it avoids a full copy of a 10GB file and keeps the worker stateless; fall back to B per job when the container layout defeats HTTP seeking. This must be validated with a large non-faststart file before the plan freezes it.
**Libraries:** —

**Revisions:**
- 2026-10-10 — Processing outputs (AMB-5): persist duration, size, container, codec, width, height, bitrate and fps plus the raw ffprobe JSON; thumbnail is a JPEG 640px wide taken at 10% of the duration (minimum 1s). _Rationale:_ complete metadata with a frame that avoids intro black frames.
- 2026-10-10 — Spike OQ-1 (condition of this TD), **verdict: A confirmed**; the per-job fallback to B stays as a safety net, not as the default. Setup: Debian 12.15 container (`node:22-slim`; the project image `node:25.6.0-slim` was not pulled, both are Debian 12 and `ffmpeg 7:5.1.9-0+deb12u1`, the version TD-06 cites, came from apt), H.264/AAC MP4 of 2,077,217,074 bytes (1500 s, 1280x720, 11 Mb/s) with `moov` after `mdat` (top-level atoms: `ftyp`@0, `free`@32, `mdat`@40, `moov`@2,075,946,186, size 1,270,888 — no faststart), served by a Node HTTP server that honors `Range` and counts bytes read from disk. Results, against a URL with query string: `ffprobe -show_format -show_streams` → 3 ranged GETs, **3,040,360 bytes (2.90 MiB, 0.15% of the file)**, 215 ms, duration 1500.0 s; `ffmpeg -ss 150 -i <url> -frames:v 1 -vf scale=640:-2` (150 s = 10% of the duration) → 4 ranged GETs, **7,365,736 bytes (7.02 MiB, 0.35%)**, 226 ms, JPEG of 17,222 bytes. Both tools read the head, jump to the `moov` by `Range` (`bytes=2075946186-`), then seek; none read the whole object. _Limitations:_ 2 GB tested, 10 GB not (a 10 GB file uses the same `Range` mechanism, only larger `mdat`/`co64`); the server imitates S3 `Range` semantics on loopback, so the real storage (`pgsty/silo`), SigV4 presigned GET and network latency were **not** exercised — the storage SI should include one smoke test of this exact flow against the Compose service; only one container layout (MP4/H.264) was tested (MKV/WebM/AVI not covered). Spike files are disposable and live outside the repository. _Rationale:_ read volume stays in the order of MB, so no scratch disk and no full copy is needed.
- 2026-10-10 — OQ-1 closed: the spike evidence above is accepted as sufficient to keep Option A before `plan-build`; the storage SI carries a smoke test of the real flow (presigned GET with SigV4 + ffprobe/ffmpeg over `Range`) against the Compose silo service, and the per-job fallback to B stays. _Rationale:_ spike accepted as sufficient despite its stated limits (student choice, 2026-10-10).

### phase-03-videos/TD-08

**Recommendation:** it fully meets "unique, no conflict" with no extra moving parts, and its entropy suits unlisted links. Choose B only if short URLs are a product requirement (not stated in the plan). A third-party generator (e.g., `nanoid` 6.x) was not evaluated: its module format versus the CommonJS Jest setup is **Necessita validação**.
**Libraries:** —

### phase-03-videos/TD-09

**Recommendation:** consistent with the diagram, keeps the API out of the 10GB data path, and was validated for Range and download behavior. Option B is the fallback if a single stable, unexpiring URL is mandatory.
**Libraries:** —

**Revisions:**
- 2026-10-10 — Access rule (AMB-2): the owner may stream, download and read the thumbnail in any status; other users and anonymous visitors only when the status is ready. Phase 04 adds public/unlisted visibility on top. _Rationale:_ keeps anonymous watching working without exposing drafts.
- 2026-10-18 — Access rule refined for the public GET routes (student decision; refines the 2026-10-10 entry above). (1) Routes carry @Public() plus the opt-in @OptionalAuth(): no Authorization header is anonymous, a valid token identifies the caller, a token that is present but invalid or expired returns 401. (2) A video that is not ready returns 404 VIDEO_NOT_FOUND to anyone who is not its owner, which hides drafts. (3) stream, download and thumbnail return JSON { url, expires_in } (download also returns filename), not a redirect, because an owner watching a non-ready video must send Authorization and a <video> tag cannot. (4) The owner's access is "any status" only for reading the video record: stream and download of a draft return 409 VIDEO_FILE_NOT_AVAILABLE (no completed object yet), and the thumbnail returns 409 THUMBNAIL_NOT_AVAILABLE while thumbnail_key is null. _Rationale:_ a draft has no stored file to sign a URL for; a Public route needs the caller's identity to apply the owner rule.

### phase-03-videos/TD-10

**Recommendation:** it is the challenge's literal lifecycle and the minimum that satisfies the capabilities; record the Phase 04 overlap as a known follow-up (Open Questions) rather than pre-building Option C.
**Libraries:** —

**Revisions:**
- 2026-10-10 — Keep the name draft (OQ-3 of the research); Phase 04 decides whether publication becomes a separate column. _Rationale:_ literal lifecycle of the enunciado.

### phase-03-videos/TD-11

**Recommendation:** long jobs over a network make transient failures likely, and idempotency is needed anyway because of the dual write. The exact attempt count, backoff and the re-trigger endpoint are parameters for `plan-resolve`.
**Libraries:** —

**Revisions:**
- 2026-10-10 — Parameters (AMB-4): 3 attempts with exponential backoff, base 30s; corrupt or unsupported media and missing object are non-retryable; no re-trigger endpoint in Phase 03 (the user re-uploads a failed video). _Rationale:_ smallest API surface that satisfies the failure policy.

### phase-03-videos/TD-12

**Recommendation:** conditional on TD-06 Option C (if TD-06 Option A is chosen, use Option B here). Option C does not meet the project's testing rule.
**Libraries:** —

**Revisions:**
- 2026-10-10 — Baseline (DG-1): SI-03.0 repairs the Phase 02 debt (npm run lint with 150 errors; migrations.integration-spec.ts not repeatable) before any new code, in the same branch with dedicated commits. _Rationale:_ Definition of Done requires lint and full suite green.
- 2026-10-18 — Baseline SI naming: the "SI-03.0" above is split into SI-03.1 (migrations spec repeatable) and SI-03.2 (Phase 02 lint baseline) in the phase plan. _Rationale:_ the .0.k slot is reserved for UI bootstrap SIs; scope and order are unchanged (baseline first, dedicated commits).

## Inherited Decisions Detail

_(inherited TDs from prior phases and correlator-confirmed docs — dedupe applied)_

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (@nestjs/config) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.

**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.

**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with registerAs) — The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`. Initial files for Phase 01: `src/config/database.config.ts`, `src/config/app.config.ts`.

**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Option A (Shared registerAs factory) — Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.

**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### phase-02-auth/TD-01

**Recommendation:** Argon2id — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.

**Libraries:** `argon2@^0.41.x`

### phase-02-auth/TD-02

**Recommendation:** Option A (@nestjs/passport) — The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier.

**Note:** Decision deliberately diverged from the Recommendation during implementation — custom guards were preferred over `@nestjs/passport` to keep the dependency surface smaller; social login is not on the near-term roadmap, so the plugin-architecture benefit did not justify the extra abstraction layer.

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-03

**Recommendation:** Option A (Refresh Token Rotation) — Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed. Race conditions can be mitigated with a short grace period for the old token.

**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Option B (Random Opaque Tokens in DB) — Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs (e.g., API keys). Keeps email tokens decoupled from the JWT auth system.

**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** Option A (@nestjs-modules/mailer) — Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with MailHog/Mailpit for local development without external dependencies, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.

**Libraries:** `@nestjs-modules/mailer@^2.x`, `handlebars@^4.x`

### phase-02-auth/TD-06

**Recommendation:** Option A (class-validator + class-transformer) — This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.

**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Option A (Custom Domain Exception Filter) — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity. The custom filter cost is low — two small files.

**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** Option A (@nestjs/throttler) — Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient. Using express-rate-limit would bypass NestJS's DI and guard lifecycle for no clear benefit.

**Libraries:** `@nestjs/throttler@^6.x`

**Revisions:**
- 2026-10-18 — As implemented, ThrottlerGuard is a global APP_GUARD registered in AuthModule (10 requests per 60 s for every route), not scoped to AuthModule. Phase 03 keeps @nestjs/throttler (same Option A) and overrides the limit per controller: every VideosController route uses its own @Throttle read from env (VIDEOS_THROTTLE_LIMIT, VIDEOS_THROTTLE_TTL_MS) instead of the global 10 per minute. _Rationale:_ student decision (2026-10-18); the reason beyond "the videos routes need a limit independent of the auth one" is not recorded. _(sourced from `docs/decisions/technical-decisions-phase-02-auth.md`; the prior phase's context.md predates it)_

### phase-02-auth/TD-09

**Recommendation:** Option B (Opaque) — Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate.

**Note:** Decision deliberately diverged from the Recommendation — JWT was kept to reuse the access-token signing/verification infrastructure (`@nestjs/jwt`), trading token size and base64-readability for a single token format across the codebase.

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-10

**Recommendation:** Option A — The platform is a video sharing service with URL-based channel handles. A strict `[a-z0-9_]` allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes. Hyphens can always be added in a future iteration if user feedback justifies it.

**Libraries:** —

### phase-02-auth-frontend/TD-01

**Recommendation:** Three reasons. (1) **Architectural fit.** The strict-BFF model in `next-frontend-config-base/TD-03` already nominates the Route Handler as the only NestJS caller; cookie-based sessions are the natural match, and Auth.js's framework adds layers between the BFF and the cookie that buy nothing because the backend is the auth authority — Auth.js's value (DB adapters, OAuth providers, magic-link, `getServerSession` helpers) is mostly unused in this configuration. (2) **Smaller blast radius.** A ~50-LOC session helper is grep-friendly, debuggable, and test-friendly via the existing MSW+BFF integration test pattern; a misconfigured Auth.js callback is a longer fault-isolation loop. (3) **Compatibility with Next.js 16 / React 19.** Built-in `next/headers` `cookies()` is the canonical primitive both runtimes already use; Auth.js v5 versions track Next.js majors with a lag, adding compatibility risk that Option A does not have. Option C is rejected as unsafe (`localStorage` for refresh tokens) and architecturally regressive (loses RSC personalization).
**Libraries:** —

### phase-02-auth-frontend/TD-02

**Recommendation:** Three reasons. (1) **Defense in depth on the cookie content** — `httpOnly` blocks JS, encryption blocks accidental log/proxy inspection; the marginal cost is one ~3KB dep. (2) **Single cookie to manage** simplifies logout (one `session.destroy()` call) and avoids the orphan-cookie failure mode of Option A. (3) **Room to carry minimal user metadata** (`userId`, `email`, `channelSlug`) lets `app/layout.tsx` RSC render the authenticated chrome (avatar, channel name) without a per-render `/auth/me` round-trip — Phase 04+ gains compound here. Option A is a viable downgrade if the team rejects `iron-session` for any reason; the migration A→B (or B→A) is a one-Route-Handler refactor with no test changes downstream because the BFF interface is unchanged. Option C is rejected: it solves a problem (server-side revocation) the project does not have at the cost of infrastructure the project does not own.
**Libraries:** iron-session

### phase-02-auth-frontend/TD-03

**Recommendation:** The single-flight detail is non-trivial and goes in the helper from day one — tested by MSW with a "two concurrent intercepted upstream calls; one refresh expected" assertion. Option B's client-driven pattern is rejected because it doesn't replace Option A (RSC still needs server-side refresh) — adopting B means doing both. Option C's pre-emptive timer is rejected because the failure modes (multiple tabs, sleep/wake) outweigh the latency saving and force a `"use client"` shell near the root.
**Libraries:** —

### phase-02-auth-frontend/TD-04

**Recommendation:** Three reasons. (1) **Decoupled from TD-05** — works with Route Handlers OR Server Actions; the form code does not change if TD-05 is revisited later. (2) **Aligned with shadcn's canonical form primitive** — the project already commits to `radix-nova` shadcn (`components.json`); `npx shadcn@latest add form` produces react-hook-form wrappers; choosing react-hook-form means using the supported primitive instead of hand-rolling around it. (3) **Zod-first developer ergonomics match the rest of the FE foundation** — `next-frontend-config-base/TD-01` chose Zod 4 for env; the same schemas-as-source-of-truth pattern carries to forms with zero new validator paradigm. Option B is rejected for impedance with shadcn's primitive and for over-investing in progressive-enhancement that the strict-BFF model does not require. Option C is rejected for the per-field boilerplate and the loss of client-side feedback on a project that values quick, type-safe form iteration.
**Libraries:** react-hook-form, @hookform/resolvers

### phase-02-auth-frontend/TD-05

**Recommendation:** Three reasons. (1) **Strict-BFF alignment.** `next-frontend-config-base/TD-03` named Route Handlers as the BFF surface; Option A keeps every mutation visible under `app/api/**`. (2) **Test scaffold already exists** — `next-frontend/CLAUDE.md` § Testing and `next-frontend-msw-foundation` were authored for Route-Handlers-as-functions; Option A reuses them with zero invention. (3) **Single mutation surface** — Phase 02 sets the precedent for Phases 03–07; uniformity beats per-mutation idiom-picking when the cost of inconsistency compounds (Option C). Option B has real ergonomic appeal for the simplest forms but fragments the BFF surface and forces test-pattern reinvention; if the team later wants progressive enhancement for specific forms, the migration A→B is per-form and doesn't require touching unrelated routes — A is the safer default and the cheaper baseline.
**Libraries:** —

### phase-02-auth-frontend/TD-06

**Recommendation:** Two reinforcing reasons. (1) **No first-render flicker, no round-trip** — the session is delivered in the same response as the page HTML; the Client Provider hydrates with the correct initial state; users never see "Login" briefly turn into their avatar. (2) **No new BFF endpoint** — the cookie is the source of truth, RSC reads it, the Provider broadcasts it; the BFF surface stays minimal. The `router.refresh()` requirement after mid-session mutations is a small price (one line in the relevant mutation handler) for the structural benefits. Option B is rejected for the double-read-and-flicker; Option C is dominated by Option B and rejected.
**Libraries:** —

### phase-02-auth-frontend/TD-07

**Recommendation:** Three reasons. (1) **First-paint-correct** — the user sees the right outcome on the first paint, no skeleton, no flicker. (2) **Single integration pattern across both flows** — confirmation is RSC-only; reset is RSC + Client form (TD-04, TD-05 patterns reused) — both share the "RSC owns the token, Client Component owns the input" split. (3) **Email-prefetch behavior** is solved at the backend's idempotent-confirmation level (a small note for `/plan-build` to confirm; not a separate TD). Option B's Route-Handler-as-link-target adds redirects for no clean gain. Option C is dominated.
**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** **Option A (`@nestjs/swagger`)** — é a única opção que preserva as decisões anteriores (`class-validator` em TD-06 de phase-02-auth) sem re-platform; o CLI plugin com `classValidatorShim: true` aproveita os decoradores `class-validator` existentes para inferir schemas, mantendo o boilerplate baixo. Nestia tem mérito técnico real mas o custo de migração do stack de validação inviabiliza-a sem uma decisão upstream de supersede de TD-06. Manual authoring é descartado.
**Libraries:** @nestjs/swagger

**Revisions:**
- 2026-05-12 — Esclarece que o CLI plugin (`classValidatorShim: true`) cobre apenas inferência de schemas de DTOs a partir de `class-validator`; documentação de operações, respostas tipadas por status code, contratos de erro (alinhados ao envelope de phase-02-auth/TD-07) e exemplos exigem decoradores explícitos (`@ApiOperation`, `@ApiResponse`, `@ApiBody`, `@ApiParam`, `@ApiQuery`, `@ApiExtraModels`). _Rationale:_ openapi.json gerado pelo bootstrap atual está genérico — sem detalhes de parâmetros, schemas de retorno por status, nem contratos de erro — porque a base instalada se apoiou só na introspecção automática. Esta revisão fixa que enriquecimento via decoradores explícitos faz parte da Option A escolhida, não é trabalho fora do escopo do TD.

### openapi-docs-nestjs/TD-02

**Recommendation:** **Option C (Ambos)** — o custo marginal sobre Option A é apenas um npm script (~15 linhas) e o benefício é uma fundação correta para futura integração FE (codegen offline) sem perder a UI interativa que dev/QA usam. Option B sozinho pune a experiência de desenvolvimento em dev/local; Option A sozinho compromete o pipeline de codegen futuro. Combinar é dominante.
**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** **Option B (Apenas em dev/staging)** — alinha com a postura defensiva já estabelecida em phase 02 e não compromete consumidores legítimos (o `openapi.json` commitado em TD-02 cumpre o papel de "spec consultável fora da UI"). Re-abrir como Option A ou C é trivial no futuro se um caso de uso de API pública aparecer.
**Libraries:** —

## Inherited Conventions

_(from phases-reader — compact list)_

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories, one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOptions: { allowUn... _(from phase 01)_
- Config is injected via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function for non-DI contexts... _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 01)_
- Database connection parameters are sourced from a single `databaseConfig` factory, never duplicated between `AppModule` and `data-source.ts`. _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning `autoLoadEntitie... _(from phase 01)_

## Inherited Deferred Capabilities

_(from phases-reader — informational-only; plan-validate does NOT fire issues based on unaddressed entries)_

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| "Confirmação de conta via e-mail com link de ativação" | deferred | phase-02-auth-frontend | deferred_to_next_phase — UI landing screen de-scoped 2026-05-14; FE confirmation flow (TD-07) picked up by a future phase. BE side unchanged in `phase-02-auth`. |
| "Logout" | deferred | phase-02-auth-frontend | deferred_to_next_phase — logout button lives inside authenticated chrome (typically Phase 04). Phase 02 still implements POST `/api/auth/logout` (BFF route handler + `session.destroy()`) so the contract is ready when the chrome lands. |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | phase-02-auth-frontend | deferred_to_next_phase — `/forgot-password` ships this phase sending the e-mail; the reset-password destination screen is absent from Figma → link destination remains a 404 until a later phase delivers the screen via `/screen-inventory` extension run. Documented as a known gap. |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | phase-02-auth-frontend | a tela de confirmação da conta não será implementada nesta fase corrente, será adiada — the umbrella bullet's full coverage requires the confirmation and reset-password destination screens; both are deferred per Non-UI rows above. The 3 ship-this-phase telas (signup, login, forgot-password) are inventoried and covered by their own verbs; the umbrella bullet itself is deferred to the phase that lands the missing screens. |

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### nestjs-project

_(from `testing-guide-nestjs-project` — Feature Implementation Checklist)_

| Artifact type | Required layers |
|---------------|-----------------|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` |
| Service with branching + DB | Unit: branch logic (mock repo) + Integration: DB contract |
| Service with DB only (no branching) | Integration: DB contract |
| Service with configured lib (JWT, cache) | Unit: real lib with test config |
| Service with side-effect dep (email, storage) | Integration: real capture service (Mailpit) or local adapter |
| Module with configured imports | Unit: compilation test |
| Controller | E2E only — do NOT write unit tests |
| DTO | E2E: one validation wiring test per endpoint |
| Guard (delegates to service for business logic) | E2E + Unit if complex internal logic |
| Guard (simple, delegates to Passport) | E2E only |
| Strategy (Passport) | E2E via guard |
| Pipe (custom transformation/validation) | Unit |
| Interceptor (response transform, logging) | Unit and/or E2E |
| Exception Filter | Unit + E2E |
| Middleware | E2E |
