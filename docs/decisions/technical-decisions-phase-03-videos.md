---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-10-10
scope_description: "Backend and infrastructure for video upload (up to 10GB) and background processing: queue technology, direct-to-storage upload protocol, S3-compatible storage usage, worker topology, ffprobe/ffmpeg processing, unique video URL, streaming/download delivery, status lifecycle, failure policy and test strategy for the async pipeline."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — API (upload initiation/completion, video entity and migration, streaming/download endpoints), the video worker (queue consumer, ffprobe/ffmpeg) and the new Compose services (object storage, queue, worker). Compose and Dockerfile live in this directory.
- `next-frontend/` — Out of scope for this phase (backend-only delivery; the video UI is not part of Phase 03). No open decision here. The client-facing contracts (TD-02, TD-08, TD-09) are written so a later frontend phase can consume them.

**Method and evidence (2026-10-10).** Library behavior was checked through context7 (BullMQ, pg-boss, AWS SDK v3, tusd); S3 limits, RabbitMQ timeout and Garage compatibility through official docs; container-image availability through registry probes; and the S3 multipart/presigned/Range/CORS behavior through a disposable spike (outside the repository) against the candidate server image. Items that could not be verified are marked **Necessita validação** and repeated in "Open Questions". No decision below was made by the researcher.

**Inherited constraints (not reopened).** Phase 01: `@nestjs/config` + Joi validation + namespaced `registerAs` configs (`src/config/`). Phase 02: class-validator + `ValidationPipe`, custom domain-exception filter (error envelope), `@nestjs/throttler`, global JWT guard with `@Public()`, opaque tokens in DB. Project rules: Compose service name as host (never `localhost`), `.env` values with `<>|& ` quoted, non-TS runtime assets declared in `nest-cli.json`, migrations only through TypeORM CLI.

---

## TD-01: Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** `docs/diagrams/software-arch.mermaid` shows a Message Queue (technology "TBD") between the API and the Video Worker. One job = process one uploaded video (ffprobe + thumbnail). Volume is low, but jobs are long-running (inputs up to 10GB) and need retries and a visible failure state. The challenge requires a queue that really runs in Compose. Kafka-class event streaming was left out: it adds operational weight with no benefit for a single low-volume job type.

**Options:**

### Option A: BullMQ on Redis (`bullmq` + `@nestjs/bullmq`)
- Adds a Redis service. Jobs support `attempts` + `backoff` (fixed/exponential), `UnrecoverableError` to skip retries, and lock renewal for stalled-job detection. Latest: `bullmq` 6.3.12, `@nestjs/bullmq` 12.0.0 (peer `bullmq ^6`, `@nestjs/core ^10 || ^11 || ^12`; project is on Nest 11).
- **Pros:** first-party Nest integration (`@Processor`, `WorkerHost`); most documented path for NestJS; real, visible queue service in Compose.
- **Cons:** new stateful service; Redis must run with `maxmemory-policy=noeviction` (BullMQ docs); enqueue and the DB status update are two separate writes (dual write).

### Option B: BullMQ on its PostgreSQL backend (`createPostgresBackend`)
- Same Queue/Worker API, stored in the existing PostgreSQL (≥13, optional `pg` peer). No Redis.
- **Pros:** no new stateful service; one datastore to operate.
- **Cons:** newer backend (documented in BullMQ 6.x); whether `@nestjs/bullmq` accepts the backend factory is **Necessita validação**; the queue is not a separate service in Compose (grading text asks for a queue service).

### Option C: pg-boss (PostgreSQL)
- Library-managed schema in the app's PostgreSQL; `retryLimit` (default 2), `retryDelay`, `retryBackoff`, `retryDelayMax`; `pg-boss` 12.37.1 requires Node ≥ 22.12 (image runs Node 25.6).
- **Pros:** no new service; jobs are rows next to the video row, which may allow enqueue and status update in one DB transaction (exact API **Necessita validação**).
- **Cons:** no first-party Nest module (thin custom wrapper); queue is not a separate Compose service; polling-based delivery.

### Option D: RabbitMQ (AMQP; `amqplib` or Nest RMQ transport)
- Dedicated broker service with explicit ack/nack and dead-lettering.
- **Pros:** purpose-built broker; clear separation; strong delivery semantics.
- **Cons:** delivery-acknowledgement timeout defaults to 30 minutes (channel closed and messages requeued when exceeded; per-queue `x-consumer-timeout` exists, and from RabbitMQ 4.3 only for quorum queues), so long jobs need care; heaviest to operate; manual DLQ/retry wiring.

**Recommendation:** **Option A** — it is the shortest path with first-party NestJS support and keeps the queue a real, separate Compose service, which is what the acceptance criteria text expects. The cost is one extra Redis container and a dual write that TD-11 must make idempotent. If minimizing infrastructure outweighs the "visible queue service" expectation, Option C is the strongest alternative because of the shared-transaction potential.

**Decision:** **A (BullMQ on Redis)** - accepted from the research recommendation (student, 2026-10-10)
**Libraries:** bullmq, @nestjs/bullmq

**Revisions:**

- 2026-10-18 — Libraries: `ioredis` is added (`^5.11.1`); the Libraries line above is superseded by `bullmq`, `@nestjs/bullmq`, `ioredis`. _Rationale:_ found in SI-03.7: `bullmq` 6.3.17 lists `ioredis` (>=5.0.0) only as an optional peer, and `connection: { host, port }` fails with "BullMQ could not load the optional 'ioredis' package" without it. Version 5.x chosen because it was the one exercised against the Compose Redis; 6.0.0 exists and was not tested (student, 2026-10-18).
- 2026-10-18 — Test tooling: `@nestjs/bullmq` 12.0.0 is ESM-only (`"type": "module"`); Node 25 loads it with `require`, but Jest 30 in CommonJS mode fails with `SyntaxError: Unexpected token 'export'`. Both Jest configs (`package.json` and `test/jest-e2e.json`) get `transformIgnorePatterns` for `@nestjs/bullmq` and `@nestjs/bull-shared` and a ts-jest transform with `allowJs` for `.js`. _Rationale:_ keeps the decided library versions; alternatives rejected by the student: downgrading `@nestjs/bullmq` to 11.x (compatibility with `bullmq` 6 not verified) and Jest native ESM (changes every suite) (student, 2026-10-18).

---

## TD-02: Upload Strategy for Files up to 10GB

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance; Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Context:** The file must never traverse the API in a way that ties it up. The API creates the draft video, hands the client what it needs to send bytes directly to storage, and learns about completion (TD-05). The handshake lives on both sides (API contract + client), hence Cross-layer. A single presigned PUT is not an option: S3 documents a 5 GB cap per single PUT (**Necessita validação** — not re-fetched here), below 10GB. S3 multipart limits (official doc): parts 5 MiB–5 GiB (no minimum for the last part), up to 10,000 parts, `ListParts` returns up to 1,000 per page.

**Options:**

### Option A: S3 multipart upload with per-part presigned URLs
- `POST` creates the draft video and calls `CreateMultipartUpload`; the API returns presigned `UploadPart` URLs (batched); the client PUTs each part straight to storage and the server finalizes (TD-05). Resume = `ListParts`. Part size is a parameter (e.g., 64–128 MiB keeps a 10GB file at ~80–160 parts).
- Spike evidence (candidate server of TD-03, AWS SDK v3): 3 presigned part PUTs → 200, `ListParts` OK, `CompleteMultipartUpload` OK, `HeadObject` size matched.
- **Pros:** zero bytes through the API; uses the storage's native protocol; no extra service; resumable by part.
- **Cons:** the client must implement part slicing/retry; browser use needs bucket CORS exposing `ETag`; more API surface (initiate, sign parts, complete, abort).

### Option B: tus resumable protocol (tusd or `@tus/server`)
- Standard resumable-upload protocol with ready-made clients. `tusd` has an S3 store (`-s3-endpoint` works with MinIO-style servers) and HTTP hooks (`pre-create`, `post-finish`); `-max-size` is unlimited by default. `@tus/server` can also be embedded in a Node/Nest app.
- **Pros:** mature resumable semantics and client libraries; hooks give a natural completion signal.
- **Cons:** extra component (tusd service or in-process server); the video row, authorization and key naming must be bridged through hooks; the app's JWT guard does not apply to a separate tusd by default.

### Option C: API-proxied streaming upload (multipart/form-data via the API to storage)
- The API receives the request and pipes it to storage with backpressure.
- **Pros:** simplest client; one endpoint; full server-side control.
- **Cons:** the 10GB body occupies an API connection, bandwidth and timeouts for the whole transfer — the exact pattern the challenge lists as automatic failure ("arquivo de 10GB passando pela API"); no native resume.

**Recommendation:** **Option A** — it satisfies "not through the API" with the storage's own protocol and no extra service, and the spike confirmed the flow against the candidate server. Option B is the better choice if client-side resumability and a standard client library matter more than keeping the component count low.

**Decision:** **A (S3 multipart upload with per-part presigned URLs)** - accepted from the research recommendation (student, 2026-10-10)

**Revisions:**

- 2026-10-10 — Acceptance criterion for "no performance impact" (AMB-1): zero bytes of the file pass through the API, proven by an integration test that sends parts straight to storage, plus a manual smoke with a 10GB sparse file recorded in progress.md showing the API stays responsive during the upload. _Rationale:_ structural criterion plus manual smoke (student choice).
- 2026-10-10 — Ownership and initiation payload (AMB-3): the video belongs to the channel (FK channel_id, derived from the authenticated user 1:1 channel); initiation receives filename, size in bytes and content type; the title is optional and defaults to the filename without extension. _Rationale:_ channel as owner aligns with the Phase 04 channel management.
- 2026-10-18 — No abort endpoint: Phase 03 exposes initiate, part-urls, parts (resume via ListParts) and complete only; AbortMultipartUpload is not offered to the client. An upload that is never completed stays in draft and its multipart upload stays open in storage. _Rationale:_ student decision; cleanup of drafts and orphan multipart uploads is a follow-up for Phase 04 (see TD-05 Revisions).

---

## TD-03: Local S3-Compatible Server Image

**Scope:** Repo-wide

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** The challenge and `CLAUDE.md` fix the storage as S3-compatible, "in practice MinIO in Docker". **Divergence verified on 2026-10-10:** the official `minio/minio` Docker Hub repository returns "object not found" through the Docker Hub API, `quay.io/minio/minio` requires authentication, and no official tag resolved with `docker manifest inspect`. Public reports state MinIO stopped publishing community images in October 2025. The S3 API is unchanged, so this is a decision about *which image serves it*, not about the S3 contract. Candidates below were all resolved with `docker manifest inspect` on this date.

**Options:**

### Option A: `pgsty/silo` (community fork of MinIO)
- Maintained fork that keeps the protocol and `MINIO_*` variables; AGPL-3.0; last server release seen `RELEASE.2026-09-16`; runs with `server /data --console-address ":9001"`; bundles the `mcli` client. Not affiliated with MinIO, Inc.
- Spike evidence: presigned multipart parts, `ListParts`, `CompleteMultipartUpload`, `Range` → 206 with `Content-Range`, `response-content-disposition`, `PutBucketCors` + preflight with `Access-Control-Allow-Origin` and `ExposeHeaders: ETag` all worked.
- **Pros:** drop-in for MinIO-based docs/tooling; full feature coverage observed; console on 9001.
- **Cons:** third-party fork (maintainer risk); `latest` tags must be pinned deliberately; lifecycle `AbortIncompleteMultipartUpload` was rejected by my test request (see Open Questions).

### Option B: Chainguard `cgr.dev/chainguard/minio`
- Free tier publishes `latest` (rebuilt frequently); pinned versions appear to be a customer offering.
- **Pros:** hardened, regularly rebuilt image from a known vendor.
- **Cons:** only a floating `latest` is documented as free (poor reproducibility for an academic deliverable); base MinIO version and license terms not stated in the source read; not exercised in the spike.

### Option C: Garage (`dxflrs/garage`)
- Different S3-compatible system, small footprint. Docs mark multipart, presigned URLs and CORS as implemented; lifecycle only partially (AbortIncompleteMultipartUpload and Expiration); bucket notifications missing.
- **Pros:** very light; actively published (image pushed 2026-10-10).
- **Cons:** requires cluster-layout bootstrap before use; no bucket notifications (rules out the event path of TD-05 Option B); not a MinIO drop-in; not exercised in the spike.

### Option D: RustFS (`rustfs/rustfs`)
- Apache-2.0 S3-compatible store in Rust, single `docker run`, ports 9000/9001.
- **Pros:** permissive license; active releases; event notifications listed as available.
- **Cons:** younger project; multipart/presigned/CORS coverage not confirmed in the README (compatibility matrix not read); not exercised in the spike.

**Recommendation:** **Option A** — it is the only candidate whose required behaviors (multipart with presigned parts, Range/206, content-disposition, CORS) were observed working, and it keeps the "MinIO in Docker" mental model of the challenge. Whatever is chosen, the image tag must be pinned in `compose.yaml` and the divergence from "MinIO" recorded in the phase documentation.

**Decision:** **A (pgsty/silo, tag pinned in compose.yaml)** - accepted from the research recommendation (student, 2026-10-10)

**Revisions:**

- 2026-10-10 — Lifecycle rule AbortIncompleteMultipartUpload is not applied (OQ-1 of the research): abandoned multipart uploads are not cleaned automatically in the local storage. _Rationale:_ known limitation, no capability requires it; cleanup is out of scope (see TD-05).
- 2026-10-10 — Substitution MinIO to pgsty/silo is recorded in the plan Deliverables, in a comment of compose.yaml with the pinned image tag, and in the final CLAUDE.md update (OQ-5 of the research). _Rationale:_ documentation consistency with the enunciado.

---

## TD-04: Storage Access: SDK, Endpoint Topology and Bucket Layout

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails); Reprodução via streaming (sem necessidade de download completo)

**Context:** API and worker both read/write storage and the client talks to it directly through presigned URLs. Two constraints apply to every option. (1) A SigV4 presigned URL is signed for the host used to generate it, so the API needs an **internal endpoint** (Compose service name, e.g. `<s3-service>:9000`) for its own calls and a **public endpoint** (host-published port) for URLs handed to clients; the "never `localhost`" project rule applies to service-to-service calls, not to the client-facing URL. (2) These env keys are cross-component (Joi schema, `compose.yaml`, `.env.example`) and must be defined once.

**Options:**

### Option A: AWS SDK v3 (`@aws-sdk/client-s3`, `s3-request-presigner`, `lib-storage`) + one bucket with key prefixes
- `S3Client` with `endpoint` + `forcePathStyle: true`; `getSignedUrl(client, new UploadPartCommand(...))`. Keys like `videos/{videoId}/original.<ext>` and `thumbnails/{videoId}/default.jpg`. Version seen: 3.1149.0.
- **Pros:** the reference S3 API; presigning of multipart parts is a documented first-class use (spike used exactly this); same code runs against real S3 later; single bucket = one policy/CORS/lifecycle to manage.
- **Cons:** modular SDK adds several packages; prefix-level (not bucket-level) policy differences.

### Option B: AWS SDK v3 + one bucket per asset type (`videos`, `thumbnails`)
- Same client, separate buckets.
- **Pros:** per-type policy (e.g., thumbnails readable by anonymous users, videos only through presigned URLs); independent lifecycle rules.
- **Cons:** two buckets to provision, CORS to configure twice; cross-bucket naming in env and bootstrap.

### Option C: `minio` JS client (`minio` 8.0.7) + one bucket
- Simpler single-package API for common operations.
- **Pros:** compact API for put/get/presign.
- **Cons:** presigning a specific multipart `UploadPart` is not a documented first-class call (**Necessita validação**); couples code to the MinIO client rather than to the S3 contract the challenge targets for production.

**Recommendation:** **Option A** — it uses the S3 contract the challenge says production will use and was exercised end to end in the spike. Separate buckets (B) become attractive only if Phase 04/05 needs anonymous-readable thumbnails with private videos.

**Decision:** **A (AWS SDK v3 + one bucket with key prefixes; internal and public endpoints)** - accepted from the research recommendation (student, 2026-10-10)
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, @aws-sdk/lib-storage

**Revisions:**

- 2026-10-10 — Public endpoint (ICC-1): presigned URLs for the client use a separate env value (S3_PUBLIC_ENDPOINT), the only place where the host-published address is accepted; the rule of never using localhost keeps applying to service-to-service calls. Recorded in the phase documentation. _Rationale:_ reaffirm the exception and document it.
- 2026-10-10 — Single PUT cap confirmed in the official AWS docs (OQ-4 of the research): a single PUT uploads up to 5 GB (docs.aws.amazon.com/AmazonS3/latest/userguide/upload-objects.html); multipart parts are 5 MiB to 5 GiB, up to 10,000 parts (docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html). _Rationale:_ justifies excluding a single presigned PUT.
- 2026-10-18 — Libraries: @aws-sdk/lib-storage dropped; the phase installs @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner (with bullmq and @nestjs/bullmq from TD-01). _Rationale:_ upload is multipart with per-part presigned URLs sent straight from the client to storage, so no capability uses Upload; the Libraries line above still lists it and is superseded by this Revision.

---

## TD-05: Upload Completion Signal and Job Enqueue Trigger

**Scope:** Cross-layer

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** Something must (a) finalize the multipart upload (needs the part ETags), (b) confirm the object exists with the expected size, (c) move the video out of `draft` and enqueue the job. The mechanism must also be testable against the real Compose services (project rule: do not mock what runs for real). Depends on TD-01 (queue) and TD-02 (protocol).

**Options:**

### Option A: Explicit "complete" call to the API
- Client calls `POST /videos/{id}/upload/complete`; the API lists parts with `ListParts` (so the client need not carry ETags), calls `CompleteMultipartUpload`, verifies `HeadObject` size, updates status and enqueues — idempotently.
- **Pros:** deterministic and easy to test end to end; the API owns authorization and validation at the moment of completion; storage-agnostic.
- **Cons:** relies on the client to call it (abandoned uploads never enqueue; see TD-11/Open Questions).

### Option B: Storage event notification (bucket notification → webhook/queue target)
- The storage emits an object-created event consumed by the API or directly by the queue.
- **Pros:** no dependency on the client; reacts to any upload path.
- **Cons:** event configuration is server-specific (MinIO-family targets vs SNS/SQS/EventBridge on real S3; Garage has no bucket notifications); harder to make deterministic in tests; a multipart upload still needs someone to call Complete first.

**Recommendation:** **Option A** — explicit, testable and independent of the storage vendor's event mechanism (which the TD-03 candidates do not share). Option B can be layered later as a safety net.

**Decision:** **A (explicit complete call to the API)** - accepted from the research recommendation (student, 2026-10-10)

**Revisions:**

- 2026-10-10 — Cleanup of abandoned drafts and orphan multipart uploads is out of Phase 03 (OQ-2 of the research); uploads never completed stay in draft; follow-up for Phase 04. _Rationale:_ no capability of the phase requires it.
- 2026-10-18 — Abort deliberately not offered (student decision): the only ways out of draft are the explicit complete call or the Phase 04 cleanup follow-up. _Rationale:_ keeps the completion signal single-path; complements the entry above.

---

## TD-06: Worker Topology and Runtime Image

**Scope:** Repo-wide

**Capability:** Serviço de processamento em segundo plano (filas); Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** The diagram shows the Video Worker as its own container consuming the queue. Today there is a single image (`nestjs-project/Dockerfile.dev`, `node:25.6.0-slim`, Debian 12, only `procps` and `curl` added) with the repo bind-mounted, and all tests run via `docker compose exec nestjs-api`. `ffmpeg` (which ships `ffprobe`) is available from apt (`ffmpeg 7:5.1.9-0+deb12u1`) but is not in the image. Running the processor inside the API process was left out: it contradicts the diagram and competes with request handling.

**Options:**

### Option A: Second Nest entrypoint + dedicated worker image
- `src/worker.ts` bootstraps a standalone application context; `Dockerfile.worker` adds `ffmpeg`; Compose service `video-worker`.
- **Pros:** API image stays slim; clean separation of runtime dependencies.
- **Cons:** two images to maintain; worker tests must run inside the worker container (see TD-12); bind-mount and env duplication.

### Option B: Separate package/project for the worker (own `package.json`)
- A `video-worker/` directory with its own dependencies, sharing only contracts.
- **Pros:** strongest isolation; independent deploy.
- **Cons:** duplicates config, entities and migrations access; breaks "somar fase, não reescrever"; largest effort for this scope.

### Option C: Same image for API and worker, different `command`
- Add `ffmpeg` to `Dockerfile.dev`; Compose service `video-worker` reuses the image with `command` running the worker entrypoint.
- **Pros:** one image, one set of dependencies, every test runs in `nestjs-api`; least Compose and Docker code.
- **Cons:** API image carries ffmpeg it does not use; no production-grade slimming (the repo only has a dev Dockerfile today).

**Recommendation:** **Option C** — the project has only a development image, and a single image keeps the whole test suite runnable through the existing `docker compose exec nestjs-api` workflow. Option A becomes preferable once a production Dockerfile exists.

**Decision:** **C (same image for API and worker, separate Compose service with its own command)** - accepted from the research recommendation (student, 2026-10-10)

---

## TD-07: Media Processing: ffprobe/ffmpeg Invocation

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** The worker must extract duration/metadata and produce a thumbnail from a frame of a file that can be 10GB. `fluent-ffmpeg` was left out: npm marks version 2.1.3 as deprecated ("Package no longer supported"). Transcoding/HLS is not a Phase 03 capability and is not considered. Thumbnail frame position (fixed offset vs fraction of duration) and image format are parameters to settle in `plan-resolve`.

**Options:**

### Option A: Direct `child_process.spawn` of `ffprobe`/`ffmpeg` reading a presigned GET URL
- ffprobe (`-print_format json`) and ffmpeg (`-ss` seek, one frame) read the object over HTTP using range requests; no local copy.
- **Pros:** no 10GB temp disk; fast for seek-based tasks; no wrapper dependency.
- **Cons:** needs the internal endpoint reachable from the worker; behavior depends on container format (e.g., `moov` atom at the end can force extra reads) — **Necessita validação** with large files.

### Option B: Download to temp storage, then process locally
- The worker streams the object to `/tmp`, runs ffprobe/ffmpeg on the file, uploads the thumbnail, deletes the temp file.
- **Pros:** most predictable tool behavior; independent of HTTP-seek quirks.
- **Cons:** needs up to 10GB of scratch disk per concurrent job; slower start; cleanup on crash.

**Recommendation:** **Option A** — it avoids a full copy of a 10GB file and keeps the worker stateless; fall back to B per job when the container layout defeats HTTP seeking. This must be validated with a large non-faststart file before the plan freezes it.

**Decision:** **A (spawn ffprobe/ffmpeg over a presigned GET URL; per-job fallback to B; condition: validate with a large non-faststart file before plan-build)** - accepted from the research recommendation (student, 2026-10-10)

**Revisions:**

- 2026-10-10 — Processing outputs (AMB-5): persist duration, size, container, codec, width, height, bitrate and fps plus the raw ffprobe JSON; thumbnail is a JPEG 640px wide taken at 10% of the duration (minimum 1s). _Rationale:_ complete metadata with a frame that avoids intro black frames.
- 2026-10-10 — Spike OQ-1 (condition of this TD), **verdict: A confirmed**; the per-job fallback to B stays as a safety net, not as the default. Setup: Debian 12.15 container (`node:22-slim`; the project image `node:25.6.0-slim` was not pulled, both are Debian 12 and `ffmpeg 7:5.1.9-0+deb12u1`, the version TD-06 cites, came from apt), H.264/AAC MP4 of 2,077,217,074 bytes (1500 s, 1280x720, 11 Mb/s) with `moov` after `mdat` (top-level atoms: `ftyp`@0, `free`@32, `mdat`@40, `moov`@2,075,946,186, size 1,270,888 — no faststart), served by a Node HTTP server that honors `Range` and counts bytes read from disk. Results, against a URL with query string: `ffprobe -show_format -show_streams` → 3 ranged GETs, **3,040,360 bytes (2.90 MiB, 0.15% of the file)**, 215 ms, duration 1500.0 s; `ffmpeg -ss 150 -i <url> -frames:v 1 -vf scale=640:-2` (150 s = 10% of the duration) → 4 ranged GETs, **7,365,736 bytes (7.02 MiB, 0.35%)**, 226 ms, JPEG of 17,222 bytes. Both tools read the head, jump to the `moov` by `Range` (`bytes=2075946186-`), then seek; none read the whole object. _Limitations:_ 2 GB tested, 10 GB not (a 10 GB file uses the same `Range` mechanism, only larger `mdat`/`co64`); the server imitates S3 `Range` semantics on loopback, so the real storage (`pgsty/silo`), SigV4 presigned GET and network latency were **not** exercised — the storage SI should include one smoke test of this exact flow against the Compose service; only one container layout (MP4/H.264) was tested (MKV/WebM/AVI not covered). Spike files are disposable and live outside the repository. _Rationale:_ read volume stays in the order of MB, so no scratch disk and no full copy is needed.
- 2026-10-10 — OQ-1 closed: the spike evidence above is accepted as sufficient to keep Option A before `plan-build`; the storage SI carries a smoke test of the real flow (presigned GET with SigV4 + ffprobe/ffmpeg over `Range`) against the Compose silo service, and the per-job fallback to B stays. _Rationale:_ spike accepted as sufficient despite its stated limits (student choice, 2026-10-10).

---

## TD-08: Unique Video Identifier and URL Shape

**Scope:** Cross-layer

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** The identifier appears in the public URL (the later "unlisted = reachable only via link" rule makes unguessability relevant). The title does not exist when the draft is created at upload start, so a title-derived slug cannot be the identifier. All entities already use `uuid` primary keys.

**Options:**

### Option A: Expose the existing UUID primary key (`/videos/{id}`)
- No extra column; uniqueness guaranteed by the primary key.
- **Pros:** zero collision handling; 122 random bits; simplest migration.
- **Cons:** long URLs; couples the public identifier to the internal key.

### Option B: Dedicated short random `public_id` column (unique index)
- Generated with `node:crypto` (`randomBytes` → base64url, ~11 chars); retry on unique-constraint violation.
- **Pros:** short, shareable URLs; public id can be rotated independently of the PK.
- **Cons:** extra column, index and collision-retry code; 64-bit space is weaker than a UUID for unlisted-by-link.

**Recommendation:** **Option A** — it fully meets "unique, no conflict" with no extra moving parts, and its entropy suits unlisted links. Choose B only if short URLs are a product requirement (not stated in the plan). A third-party generator (e.g., `nanoid` 6.x) was not evaluated: its module format versus the CommonJS Jest setup is **Necessita validação**.

**Decision:** **A (existing UUID primary key as public identifier)** - accepted from the research recommendation (student, 2026-10-10)

---

## TD-09: Streaming and Download Delivery

**Scope:** Cross-layer

**Capability:** Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

**Context:** The architecture diagram draws "Frontend → Object Storage: Streams (HTTPS)", i.e., playback is expected to come from storage, not through the API. Anonymous users may watch (plan §1), while Phase 04/05 add public/unlisted visibility, so access control cannot be left to chance. Range requests (HTTP 206) are required for seek without full download.

**Options:**

### Option A: API authorizes, then returns a short-lived presigned GET URL (redirect or JSON)
- Streaming: storage serves `Range` → 206 directly. Download: same URL with `ResponseContentDisposition: attachment`.
- Spike evidence: presigned GET with `Range: bytes=0-99` → `206` with `Content-Range: bytes 0-99/<size>` and `Accept-Ranges: bytes`; `response-content-disposition` returned `attachment; filename="video.mp4"`.
- **Pros:** API stays out of the data path; access decision stays in the API; same mechanism for stream and download.
- **Cons:** URLs expire (client must re-request); needs the public endpoint (TD-04); players must handle the redirect/JSON step.

### Option B: API proxy with Range support (`206 Partial Content`)
- The API reads the object with a `Range` header and pipes the bytes.
- **Pros:** full control and logging; one stable URL; storage never exposed.
- **Cons:** every watched byte crosses the API (bandwidth, concurrency); must implement Range/If-Range/HEAD semantics correctly.

### Option C: Public-read bucket/prefix (stable object URLs)
- Anonymous GET policy; storage serves directly.
- **Pros:** simplest; best cacheability.
- **Cons:** no per-video access control (conflicts with the later unlisted/private rules); object keys become public URLs.

**Recommendation:** **Option A** — consistent with the diagram, keeps the API out of the 10GB data path, and was validated for Range and download behavior. Option B is the fallback if a single stable, unexpiring URL is mandatory.

**Decision:** **A (API authorizes, then returns a short-lived presigned GET URL)** - accepted from the research recommendation (student, 2026-10-10)

**Revisions:**

- 2026-10-10 — Access rule (AMB-2): the owner may stream, download and read the thumbnail in any status; other users and anonymous visitors only when the status is ready. Phase 04 adds public/unlisted visibility on top. _Rationale:_ keeps anonymous watching working without exposing drafts.
- 2026-10-18 — Access rule refined for the public GET routes (student decision; refines the 2026-10-10 entry above). (1) Routes carry @Public() plus the opt-in @OptionalAuth(): no Authorization header is anonymous, a valid token identifies the caller, a token that is present but invalid or expired returns 401. (2) A video that is not ready returns 404 VIDEO_NOT_FOUND to anyone who is not its owner, which hides drafts. (3) stream, download and thumbnail return JSON { url, expires_in } (download also returns filename), not a redirect, because an owner watching a non-ready video must send Authorization and a <video> tag cannot. (4) The owner's access is "any status" only for reading the video record: stream and download of a draft return 409 VIDEO_FILE_NOT_AVAILABLE (no completed object yet), and the thumbnail returns 409 THUMBNAIL_NOT_AVAILABLE while thumbnail_key is null. _Rationale:_ a draft has no stored file to sign a URL for; a Public route needs the caller's identity to apply the owner rule.

---

## TD-10: Video Status Model

**Scope:** Backend

**Capability:** Pré-cadastro automático do vídeo como rascunho ao iniciar o upload; Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** The challenge describes the lifecycle as "rascunho → processando → pronto/erro" and requires it persisted. Phase 04 will add a "rascunho → publicação" flow and public/unlisted visibility, so the word "draft" will gain a second meaning (published vs not). Depends on TD-05 (when `draft` ends).

**Options:**

### Option A: One `status` enum: `draft` → `processing` → `ready` | `failed`
- `draft` covers "upload not yet completed"; `failed` carries a reason column.
- **Pros:** matches the challenge text exactly; smallest migration.
- **Cons:** cannot tell an in-progress upload from an abandoned one except by age; `draft` will overlap with Phase 04 publication semantics.

### Option B: Finer enum: `draft` → `uploading` → `uploaded` → `processing` → `ready` | `failed`
- **Pros:** observable transitions; separates "never completed" from "queued"; eases cleanup rules.
- **Cons:** more states and transition guards; more migration churn if Phase 04 renames things.

### Option C: Orthogonal columns: processing status now, publication/visibility added in Phase 04
- `processing_status` (draft/processing/ready/failed) now; a separate publication axis later.
- **Pros:** avoids the "draft" overlap by design.
- **Cons:** over-designs Phase 03 for a phase not yet planned; two columns to keep coherent.

**Recommendation:** **Option A** — it is the challenge's literal lifecycle and the minimum that satisfies the capabilities; record the Phase 04 overlap as a known follow-up (Open Questions) rather than pre-building Option C.

**Decision:** **A (single status enum draft -> processing -> ready or failed)** - accepted from the research recommendation (student, 2026-10-10)

**Revisions:**

- 2026-10-10 — Keep the name draft (OQ-3 of the research); Phase 04 decides whether publication becomes a separate column. _Rationale:_ literal lifecycle of the enunciado.

---

## TD-11: Failure, Retry and Idempotency Policy

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** The challenge asks what happens on processing failure. With TD-01 Option A the enqueue and DB update are separate writes, so the worker must be safe to run more than once for the same video. Values (attempts, backoff) are policy parameters. Cleanup of abandoned drafts/multipart uploads has no capability in the plan and is deliberately **not** a TD here (see Open Questions).

**Options:**

### Option A: Queue-native retries with terminal `failed` and an idempotent worker
- N attempts with exponential backoff; non-retryable errors (corrupt/unsupported media) skip retries; after the last attempt the video is set to `failed` with a stored reason; re-processing overwrites the same object keys and metadata.
- **Pros:** transient errors (network, storage) recover without user action; clear terminal state; idempotency also covers duplicate enqueue.
- **Cons:** needs error classification (retryable vs not); failed videos need a way to be re-triggered (manual endpoint or none).

### Option B: Fail fast, no automatic retry
- First error sets `failed`; user/admin re-triggers.
- **Pros:** simplest; no classification.
- **Cons:** transient storage/network blips surface as failed videos; more manual work.

**Recommendation:** **Option A** — long jobs over a network make transient failures likely, and idempotency is needed anyway because of the dual write. The exact attempt count, backoff and the re-trigger endpoint are parameters for `plan-resolve`.

**Decision:** **A (queue-native retries, terminal failed, idempotent worker)** - accepted from the research recommendation (student, 2026-10-10)

**Revisions:**

- 2026-10-10 — Parameters (AMB-4): 3 attempts with exponential backoff, base 30s; corrupt or unsupported media and missing object are non-retryable; no re-trigger endpoint in Phase 03 (the user re-uploads a failed video). _Rationale:_ smallest API surface that satisfies the failure policy.

---

## TD-12: Test Strategy for the Async Pipeline

**Scope:** Backend

**Capability:** Transversal — covers: Serviço de processamento em segundo plano (filas); Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance; Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** Project rules: integration/e2e use real services from Compose, no mocks of what runs for real, `--runInBand`, and all commands run through `docker compose exec nestjs-api`. A 10GB file cannot be exercised in the suite. Multipart parts must be ≥ 5 MiB (except the last), so small-part tests are possible. Depends on TD-06: where ffmpeg exists decides where processor tests can run.

**Options:**

### Option A: Real storage + real queue + real ffmpeg, all tests in `nestjs-api`
- Integration tests drive the real processor against real storage/queue; a tiny fixture is generated at test time with `ffmpeg -f lavfi` (no binary fixture committed); multipart is tested with a few 5 MiB parts; the 10GB path is verified by a manual sparse-file smoke check outside the suite.
- **Pros:** follows the project rule literally; no mocks of the pipeline; one test entry point.
- **Cons:** requires ffmpeg in the image that runs tests (consistent with TD-06 Option C); slower suite.

### Option B: Processor tests inside the worker container
- Same real services, but run with `docker compose exec video-worker …` (TD-06 Option A).
- **Pros:** API image stays free of ffmpeg.
- **Cons:** two test entry points; split coverage reporting.

### Option C: Mock ffmpeg/ffprobe and storage in unit tests; e2e only up to enqueue
- **Pros:** fast, no extra dependencies.
- **Cons:** contradicts "não mockar o que roda de verdade no Compose"; leaves the processor and storage paths unverified.

**Recommendation:** **Option A**, conditional on TD-06 Option C (if TD-06 Option A is chosen, use Option B here). Option C does not meet the project's testing rule.

**Decision:** **A (real storage + queue + ffmpeg, all tests in nestjs-api)** - accepted from the research recommendation (student, 2026-10-10)

**Revisions:**

- 2026-10-10 — Baseline (DG-1): SI-03.0 repairs the Phase 02 debt (npm run lint with 150 errors; migrations.integration-spec.ts not repeatable) before any new code, in the same branch with dedicated commits. _Rationale:_ Definition of Done requires lint and full suite green.
- 2026-10-18 — Baseline SI naming: the "SI-03.0" above is split into SI-03.1 (migrations spec repeatable) and SI-03.2 (Phase 02 lint baseline) in the phase plan. _Rationale:_ the .0.k slot is reserved for UI bootstrap SIs; scope and order are unchanged (baseline first, dedicated commits).

---

## Open Questions (not decisions)

| ID | Question | Why it matters | Where to settle |
|----|----------|----------------|-----------------|
| OQ-1 | Lifecycle rule `AbortIncompleteMultipartUpload` was rejected by the candidate server (`InvalidArgument`) with my test request; unclear whether the request shape or the server is at fault. | Unfinished multipart uploads consume space. | Spike during `plan-resolve` / SI for storage bootstrap |
| OQ-2 | No capability covers cleanup of abandoned drafts and orphan multipart uploads. In scope for Phase 03? | Storage leak vs scope creep. | `plan-resolve` |
| OQ-3 | `draft` will mean "not published" in Phase 04. Keep the name or rename now? | Avoids a breaking enum change later. | `plan-resolve` (TD-10) |
| OQ-4 | Single PUT cap (5 GB) quoted from S3 behavior, not re-fetched in this research. | Justifies excluding single presigned PUT. | `plan-resolve` (library docs) |
| OQ-5 | Divergence: challenge/`CLAUDE.md` say "MinIO in Docker"; the official image is no longer distributed (see TD-03). Record the substitute in the final documentation. | Documentation consistency. | TD-03 + final `CLAUDE.md` update |
| OQ-6 | Baseline debt inherited from Phase 02, measured on 2026-10-10: `npm run lint` fails with 150 errors/40 warnings (0 auto-fixable; includes 6 errors in `channels.service.ts`), and `migrations.integration-spec.ts` is not repeatable (does not drop the `verification_tokens_type_enum` type; a second `npm test` fails and Jest hangs). The Definition of Done requires lint and suites green. | Blocks DoD unless paid inside Phase 03. | `plan-validate` (expected `DG-N`) → `plan-resolve` |
| OQ-7 | File naming: this file follows the challenge text (`technical-decisions-phase-03-videos.md`) while the `research` skill says "no phase number in the filename". Confirm `plan-context 03` resolves the directory `docs/phases/phase-03-videos/`. | Pipeline slug resolution. | `/plan-context 03` |

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Queue technology | A — BullMQ on Redis | **A (BullMQ on Redis)** |
| TD-02 | Cross-layer | Upload strategy for 10GB | A — S3 multipart with presigned parts | **A (S3 multipart upload with per-part presigned URLs)** |
| TD-03 | Repo-wide | Local S3-compatible server image | A — `pgsty/silo` (pinned) | **A (pgsty/silo, tag pinned in compose.yaml)** |
| TD-04 | Backend | Storage SDK, endpoints, bucket layout | A — AWS SDK v3, one bucket, internal + public endpoints | **A (AWS SDK v3 + one bucket with key prefixes)** |
| TD-05 | Cross-layer | Completion signal and enqueue trigger | A — explicit complete call | **A (explicit complete call to the API)** |
| TD-06 | Repo-wide | Worker topology and image | C — same image, separate Compose service | **C (same image for API and worker, separate Compose service with its own command)** |
| TD-07 | Backend | Media processing invocation | A — spawn ffprobe/ffmpeg over presigned URL | **A (spawn ffprobe/ffmpeg over a presigned GET URL)** |
| TD-08 | Cross-layer | Unique identifier / URL | A — existing UUID primary key | **A (existing UUID primary key as public identifier)** |
| TD-09 | Cross-layer | Streaming and download delivery | A — API-authorized presigned GET | **A (API authorizes, then returns a short-lived presigned GET URL)** |
| TD-10 | Backend | Video status model | A — `draft`/`processing`/`ready`/`failed` | **A (single status enum draft -> processing -> ready or failed)** |
| TD-11 | Backend | Failure, retry, idempotency | A — queue retries + terminal `failed` + idempotent worker | **A (queue-native retries, terminal failed, idempotent worker)** |
| TD-12 | Backend | Async pipeline test strategy | A — real services, tests in `nestjs-api` | **A (real storage + queue + ffmpeg, all tests in nestjs-api)** |