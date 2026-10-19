---
kind: phase
name: phase-03-videos
status: clean
issue_count: 0
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-18T18:12:46-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-18T18:00:03-03:00"
issues:
  - id: AMB-1
    status: resolved
    summary: "'Sem impacto na performance' (10GB) has no measurable acceptance criterion"
    resolved_by: phase-03-videos/TD-02
  - id: AMB-2
    status: resolved
    summary: "Access rule for stream/download/thumbnail undefined before Phase 04 visibility"
    resolved_by: phase-03-videos/TD-09
  - id: AMB-3
    status: resolved
    summary: "Video owner (user vs channel) and draft payload at upload start unstated"
    resolved_by: phase-03-videos/TD-02
  - id: AMB-4
    status: resolved
    summary: "Retry attempts, backoff, non-retryable errors and re-trigger undefined (TD-11)"
    resolved_by: phase-03-videos/TD-11
  - id: AMB-5
    status: resolved
    summary: "Persisted metadata fields, thumbnail frame rule, format and size unspecified"
    resolved_by: phase-03-videos/TD-07
  - id: DG-1
    status: resolved
    summary: "DoD needs green lint and repeatable migrations spec; Phase 02 baseline is red"
    resolved_by: phase-03-videos/TD-12
  - id: ICC-1
    status: resolved
    summary: "TD-04 public storage endpoint vs Docker rule 'never localhost'"
    resolved_by: phase-03-videos/TD-04
  - id: OQ-1
    status: resolved
    summary: "TD-07 needs validation with a large non-faststart file before plan freeze"
    resolved_by: phase-03-videos/TD-07
  - id: OQ-2
    status: resolved
    summary: "AbortIncompleteMultipartUpload lifecycle rule rejected by the candidate server"
    resolved_by: phase-03-videos/TD-03
  - id: OQ-3
    status: resolved
    summary: "Cleanup of abandoned drafts and orphan multipart uploads: in or out of scope"
    resolved_by: phase-03-videos/TD-05
  - id: OQ-4
    status: resolved
    summary: "`draft` overlaps with Phase 04 'not published': keep or rename"
    resolved_by: phase-03-videos/TD-10
  - id: OQ-5
    status: resolved
    summary: "5 GB single presigned PUT cap not re-fetched from official docs"
    resolved_by: phase-03-videos/TD-04
  - id: OQ-6
    status: resolved
    summary: "MinIO to pgsty/silo substitution must be recorded and the tag pinned"
    resolved_by: phase-03-videos/TD-03
---

# phase-03-videos — Validation

_Provenance note:_ this stage reads only `context.md`, which does not carry the research's Open Questions table or the project-level rules. **DG-1, ICC-1 and OQ-2 to OQ-6** came from `docs/decisions/technical-decisions-phase-03-videos.md` (OQ-6, OQ-1, OQ-2, OQ-3, OQ-4, OQ-5 of that document) and from the project `CLAUDE.md` (Docker networking, Definition of Done). They are preserved from earlier revisions; none was re-raised because the matching `Revisions` entries are in `context.md`.

_Revalidation 2026-10-18 (after `/plan-context 03` regenerated `context.md` with the 2026-10-18 Revisions of TD-02, 04, 05, 09, 12 and the phase-02-auth TD-08 Revision):_ `context.md` is not stale (every `sources_mtime` key is at or before the file on disk). All checks were rerun: 12 TDs, all `decided`, none `pending`; every capability bullet in `## Capability Coverage` maps to at least one TD; no TD carries `Scope: Frontend`; no `## UI Inventory` (UI scope absent, so UIG-N and the shared-types contract-sync rule do not fire); Check 8 skipped (slice set for NN=3 is one doc); no custom rules in `docs/rules/plan-validate/`. No new issue raised.

_Superseded text kept on purpose, not raised as an issue:_ the `**Libraries:**` line of TD-04 still lists `@aws-sdk/lib-storage` and the 2026-10-10 TD-12 Revision still says `SI-03.0`. In both cases a 2026-10-18 Revision of the same TD states the replacement (lib-storage dropped; SI-03.1 and SI-03.2) and says the earlier text is superseded, so the precedence is explicit inside the source. Consumers that read the Libraries column or the Decisions Index (`plan-resolve` → `library-refs.md`, `plan-build`) must apply the Revision.

## Findings

### Inconsistencies

_None._

### Ambiguities

_None._

### Missing Decisions

_None._

### Dependency Gaps

_None._

### Inherited Constraint Conflicts

_None._

### Unresolved Open Questions

_None._

### UI Coverage Gaps

_None._ (No UI scope in this phase; `## UI Inventory` is not emitted.)

## Resolved Issues

_Resolved on 2026-10-10 by `/plan-resolve 03`. The clarifications live as `Revisions` entries of the TD named in `resolved_by`._

- **AMB-1** _(resolved_by phase-03-videos/TD-02)_ — Acceptance criterion: zero file bytes through the API proven by an integration test, plus a manual 10GB sparse-file smoke recorded in `progress.md`.
- **AMB-2** _(resolved_by phase-03-videos/TD-09)_ — Access rule: owner in any status; other users and anonymous only when `ready`.
- **AMB-3** _(resolved_by phase-03-videos/TD-02)_ — Owner is the channel (FK `channel_id`); initiation receives filename, size and content type; title optional.
- **AMB-4** _(resolved_by phase-03-videos/TD-11)_ — 3 attempts, exponential backoff base 30s, non-retryable errors listed, no re-trigger endpoint.
- **AMB-5** _(resolved_by phase-03-videos/TD-07)_ — Persist duration, size, container, codec, width, height, bitrate, fps and raw ffprobe JSON; thumbnail JPEG 640px at 10% of duration (minimum 1s).
- **DG-1** _(resolved_by phase-03-videos/TD-12)_ — SI-03.0 repairs lint (150 errors) and `migrations.integration-spec.ts` repeatability before any new code, same branch, dedicated commits.
- **ICC-1** _(resolved_by phase-03-videos/TD-04)_ — `S3_PUBLIC_ENDPOINT` is the only place where the host-published address is accepted; documented in the phase documentation.
- **OQ-1** _(resolved_by phase-03-videos/TD-07)_ — Spike of 2026-10-10 accepted as sufficient to keep Option A (ffprobe read 2.90 MiB, thumbnail 7.02 MiB of a 2,077,217,074-byte MP4 with `moov` at the end); fallback B stays per job; the storage SI carries a smoke test of the real flow (presigned GET with SigV4 + ffprobe/ffmpeg over `Range`) against the Compose silo service. Limits stated in the TD-07 Revision: 2 GB (not 10 GB), MP4/H.264 only. _(Resolved 2026-10-10 by `/plan-resolve 03`.)_
- **OQ-2** _(resolved_by phase-03-videos/TD-03)_ — Lifecycle rule not applied; known limitation of the local storage.
- **OQ-3** _(resolved_by phase-03-videos/TD-05)_ — Cleanup of abandoned drafts and orphan multiparts is out of Phase 03; follow-up for Phase 04.
- **OQ-4** _(resolved_by phase-03-videos/TD-10)_ — Keep `draft`; Phase 04 decides about a separate publication column.
- **OQ-5** _(resolved_by phase-03-videos/TD-04)_ — Confirmed in the AWS docs (`upload-objects.html`: single PUT up to 5 GB; `qfacts.html`: parts 5 MiB to 5 GiB, up to 10,000 parts).
- **OQ-6** _(resolved_by phase-03-videos/TD-03)_ — Substitution recorded in the plan Deliverables, in a `compose.yaml` comment with the pinned tag, and in the final `CLAUDE.md` update.
