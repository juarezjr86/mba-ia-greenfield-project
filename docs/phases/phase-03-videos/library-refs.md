---
libs:
  bullmq:
    version: "^6.3.12"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-10-10T23:10:33-03:00"
  "@nestjs/bullmq":
    version: "^12.0.0"
    context7_id: "/nestjs/bull"
    fetched_at: "2026-10-10T23:10:33-03:00"
  "@aws-sdk/client-s3":
    version: "^3.1149.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-10T23:10:33-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1149.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-10T23:10:33-03:00"
  "@aws-sdk/lib-storage": # DROPPED 2026-10-18 per TD-04 Revision: not installed by this phase
    version: "^3.1149.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-10T23:10:33-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-10T23:08:51-03:00"
---

# phase-03-videos — Library References

Distilled docs for the libraries decided in this slice, pulled via Context7 on 2026-10-10. None of the five is installed yet in `nestjs-project/package.json` (only `@nestjs/common` and `@nestjs/core` `^11.0.1` are); the `version` fields are the npm `latest` seen from the `nestjs-api` container the same day. Re-check Context7 against the installed version when the SI that adds the dependency runs. Items marked **Not confirmed** were asked of Context7 and not returned; the implementing SI must confirm them in the installed package types before writing the call (project rule: never infer an API signature).

## bullmq

**Source:** `/taskforcesh/bullmq` (Context7) — High reputation, 4,244 snippets, benchmark 87.45; docs indexed at v6.3.11, npm latest 6.3.12. Maps to `phase-03-videos/TD-01` (queue) and `TD-11` (retry/idempotency).

### Idempotent enqueue by custom `jobId` (TD-11)

`queue.add(name, data, { jobId })` ignores the job when the id already exists: it emits a `duplicated` event and returns the existing job id, it does **not** throw or overwrite. A custom id must not contain `:` and must not be purely numeric. A `videoId` UUID (hyphens only) satisfies both.

```typescript
await queue.add('process-video', { videoId }, { jobId: videoId });
```

### Retry with exponential backoff (TD-11: 3 attempts, base 30 s)

```typescript
await queue.add('process-video', { videoId }, {
  jobId: videoId,
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
});
```

`backoff` also accepts `jitter` (0–1) to randomize the delay; not required by TD-11.

### Non-retryable failures (TD-11: corrupt/unsupported media, missing object)

Throwing `UnrecoverableError` inside the processor moves the job straight to `failed`, overriding `attempts`.

```typescript
import { UnrecoverableError } from 'bullmq';
throw new UnrecoverableError('unsupported media');
```

### Worker concurrency

`new Worker(queueName, processor, { connection, concurrency })` — `concurrency` is a Worker option.

**Not confirmed (check before the processing SI):** `lockDuration` and stalled-job handling for jobs that run for minutes (ffprobe/ffmpeg over HTTP); `removeOnComplete`/`removeOnFail` defaults.

## @nestjs/bullmq

**Source:** `/nestjs/bull` (Context7, repository that ships both `@nestjs/bull` and `@nestjs/bullmq`) cross-checked with `/nestjs/docs.nestjs.com` (Queues). High reputation. Maps to `phase-03-videos/TD-01`. Peer dependencies of `@nestjs/bullmq@12.0.0`: `bullmq ^3 || ^4 || ^5 || ^6`, `@nestjs/core` and `@nestjs/common` `^10 || ^11 || ^12` — compatible with the project's `^11.0.1`.

### Connection option is `connection`, not `redis` (version discrepancy)

The Context7 snippet from `docs.nestjs.com` for `BullModule.forRootAsync` shows a `redis:` key; that is the legacy `@nestjs/bull` API. For `@nestjs/bullmq` the key is `connection`. Follow the `@nestjs/bullmq` form and keep the host as the Compose service name (`redis` or whatever TD-01's Compose service is called), never `localhost`; read it from a `registerAs` config factory (inherited convention from Phase 01).

```typescript
BullModule.forRootAsync({
  imports: [ConfigModule],
  inject: [queueConfig.KEY],
  useFactory: (cfg: ConfigType<typeof queueConfig>) => ({
    connection: { host: cfg.host, port: cfg.port },
  }),
});
```

### Producer side (API)

```typescript
BullModule.registerQueue({ name: 'video-processing' });

@Injectable()
export class VideosService {
  constructor(@InjectQueue('video-processing') private readonly queue: Queue) {}
}
```

### Consumer side (worker)

```typescript
@Processor('video-processing')
export class VideoProcessor extends WorkerHost {
  async process(job: Job<{ videoId: string }>): Promise<unknown> { /* ... */ }
}
```

Queue-level events use `@QueueEventsListener(queueName)` on a class extending `QueueEventsHost`, registered as a provider, with `@OnQueueEvent('completed' | 'failed' | ...)` handlers.

### API process vs worker process (TD-06 C)

A class decorated with `@Processor` that is a provider of a module loaded by the API app starts a Worker in that process. The worker module must therefore be imported only by the worker entrypoint (`src/worker.ts`), not by `AppModule`. `BullModule.forRoot({ ..., extraOptions: { manualRegistration: true } })` exists to stop automatic registration of queues and workers. **Not confirmed:** bootstrapping the worker with `NestFactory.createApplicationContext` plus graceful shutdown hooks; confirm in the Nest docs when the worker SI is specified.

## @aws-sdk/client-s3

**Source:** `/aws/aws-sdk-js-v3` (Context7) — High reputation, 5,598 snippets, benchmark 74.24; the same id serves the three `@aws-sdk` packages of this slice. Requires Node `>=20` (container runs Node 25.6.0). Maps to `phase-03-videos/TD-04`, `TD-02`, `TD-09`.

### Client against an S3-compatible server (TD-03 `pgsty/silo`)

```typescript
import { S3Client } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  region: 'us-east-1',
  endpoint: cfg.endpoint,      // internal Compose host, e.g. http://<silo-service>:9000
  forcePathStyle: true,        // v3 name of the v2 `s3ForcePathStyle`
  credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
});
await s3.send(new GetObjectCommand({ Bucket, Key }));
```

`endpoint` accepts a static URL string and overrides rule-based endpoint resolution. Import commands from the package root (`import { GetObjectCommand } from '@aws-sdk/client-s3'`); the modular `send(command)` form is the tree-shakable one.

### Default checksums on requests (risk for S3-compatible servers)

`requestChecksumCalculation` defaults to `WHEN_SUPPORTED`: for operations that model a checksum algorithm member (the excerpt shows `PutObject`) the SDK adds `x-amz-sdk-checksum-algorithm` and computes CRC32 into `x-amz-checksum-crc32`. Setting `requestChecksumCalculation: 'WHEN_REQUIRED'` on the client removes them. **Not confirmed:** whether `pgsty/silo` rejects these headers on presigned `UploadPart`; the storage SI smoke test (TD-07 Revision of 2026-10-10) must include one presigned multipart part, and the client option is the first lever if it fails.

### Multipart commands (TD-02)

`CreateMultipartUploadCommand`, `UploadPartCommand`, `CompleteMultipartUploadCommand`, `AbortMultipartUploadCommand`, `ListPartsCommand` and `HeadObjectCommand` are the operations the flow needs (limits confirmed in TD-04: parts 5 MiB–5 GiB, up to 10,000 parts). **Not confirmed in the Context7 excerpt:** their input shapes; read them from `node_modules/@aws-sdk/client-s3` types at implementation time.

## @aws-sdk/s3-request-presigner

**Source:** `/aws/aws-sdk-js-v3` (Context7), package README. Maps to `phase-03-videos/TD-02` (presigned parts), `TD-09` (presigned GET), `TD-04` (public endpoint, ICC-1).

### `getSignedUrl`

```typescript
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const url = await getSignedUrl(client, new GetObjectCommand({ Bucket, Key }), { expiresIn: 3600 });
```

`expiresIn` (seconds) is optional and defaults to **900**. The same call signs other commands (the README mentions `PutObjectCommand`); `UploadPartCommand` follows the same shape (`UploadId` and `PartNumber` in the command input) but is **not shown** in the excerpt.

### Download with a file name (TD-09)

`GetObjectCommand` accepts `ResponseContentDisposition`, sent as the `response-content-disposition` query parameter. These response-header overrides **must be signed**: they only work on a presigned URL or an Authorization header, never on an anonymous request. That fits TD-09's presigned GET.

### Public vs internal endpoint (TD-04 Revision, ICC-1)

A presigned URL is bound to the host that signed it. The README excerpt does not cover signing for a different public host. **Inference, not documented:** use a second `S3Client` whose `endpoint` is `S3_PUBLIC_ENDPOINT` only for presigning, and keep the internal-endpoint client for server-side calls; the storage SI smoke test must exercise a presigned URL fetched from the host-published address.

## @aws-sdk/lib-storage (DROPPED 2026-10-18 — not installed; kept for reference only)

**Source:** `/aws/aws-sdk-js-v3` (Context7), `lib/lib-storage` README. Still listed in the `TD-04` Libraries line, but the 2026-10-18 Revision of `phase-03-videos/TD-04` drops it: the upload is multipart with per-part presigned URLs, so no capability uses `Upload`. Do not install it.

### What it is

`Upload` uploads a buffer, blob or stream to S3 using concurrent multipart uploads from the **calling process**: `client`, `params: { Bucket, Key, Body }`, optional `queueSize` (default 4), `partSize` (minimum 5 MB), `leavePartsOnError`, and `httpUploadProgress` events; `await upload.done()`.

### Usage in this plan

**Not confirmed by any TD.** The 10GB upload goes browser → storage through presigned parts (TD-02), so the API never runs `Upload`; the worker's only write is a 640 px JPEG thumbnail (TD-07), which fits a single `PutObjectCommand` from `client-s3`. No capability needs this package. The decision to keep or drop it from the `TD-04` Libraries line belongs to the student; if kept, `plan-build` must name the component that calls `Upload`.
