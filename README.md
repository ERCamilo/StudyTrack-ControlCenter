# StudyTrack Control Center

Separate TypeScript foundation for governed StudyTrack curriculum catalog operations.

This project is intentionally separate from the static StudyTrack PWA. It owns future
report intake, career ingestion requests, extracted candidates, human review,
publication jobs, source snapshots, and audit history.

## Current scope

- Zod contracts for:
  - `CurriculumReport`
  - `CreateCurriculumReportInput`
  - `ReviewTask`
  - `IngestionRequest`
  - `CreateIngestionRequestInput`
  - `N8nCandidateWebhook`
  - `ExtractedCandidate`
  - `CareerVersion`
  - `PublicationJob`
  - `PublicationApprovalInput`
  - `AuditEvent`
- JSON Schema exports for public contracts.
- n8n candidate intake mapping from webhook payloads into source snapshots,
  extracted candidates, and audit events.
- Report intake mapping from public report submissions into review tasks and
  audit events.
- Review task lifecycle transitions for starting review, resolving findings,
  and closing completed tasks.
- Publication approval gates that require human approval, no unresolved review
  tasks, and no candidate validation errors before catalog artifacts can be
  published.
- PostgreSQL/Prisma migration-ready model stubs.
- Schema tests for validation, lifecycle, candidate boundaries, and DB model coverage.

## Commands

```bash
pnpm install
pnpm run test:schema
pnpm test
pnpm run typecheck
pnpm run db:validate
pnpm run server:dev
```

`pnpm run db:validate` requires `DATABASE_URL` to be set. A local placeholder is
enough for schema validation:

```bash
DATABASE_URL="postgresql://user:password@localhost:5432/studytrack_control_center" pnpm run db:validate
```

## Functional local intake flow

Start the Control Center API:

```bash
pnpm run server:dev
```

The local API exposes:

- `GET /health`
- `GET /`
- `GET /api/config/universities`
- `POST /api/ingestion-requests`
- `GET /api/uasd/pensum-drafts`
- `POST /api/uasd/pensum-drafts`
- `PATCH /api/uasd/pensum-drafts/:id`
- `POST /api/uasd/pensum-drafts/:id/retry`
- `POST /api/uasd/pensum-drafts/:id/discard`
- `POST /api/uasd/pensum-drafts/:id/publish`
- `POST /api/uasd/pensum-candidates`

The n8n workflow at `n8n/workflows/uasd-pensum-ingestion.json` can be imported
into n8n. It receives the draft request created by the Control Center wizard,
fetches the UASD pensum URL, extracts table rows, and posts the parsed candidate
back to `/api/uasd/pensum-candidates`.

Open `http://127.0.0.1:3000/` to use the operator wizard. The wizard lets an
operator choose UASD, enter the career name, program code, plan, expected
periods, and official pensum URL, then create a draft extraction request. Active
drafts are deduplicated by institution, program code, and plan.

To trigger n8n directly from the wizard, configure the server with the n8n
webhook URL:

```bash
N8N_UASD_WEBHOOK_URL="http://localhost:5678/webhook/studytrack/uasd-pensum" pnpm run server:dev
```

If the webhook URL is not configured, the wizard still creates the draft and
shows the exact JSON payload that can be copied into the workflow manually.

Operator draft states:

- `draft_requested`: the draft was created and is ready for n8n extraction.
- `dispatch_failed`: the draft was created, but the n8n webhook request failed.
- `candidate_ready`: n8n returned a valid candidate and the draft can be published.
- `needs_review`: n8n returned a candidate with validation errors.
- `discarded`: the operator discarded the draft.
- `published`: the operator approved the valid candidate for publication.

The UASD page may return an anti-bot challenge to server-side HTTP clients. The
parser is covered with a captured browser fixture from:

```text
https://app.uasd.edu.do/PensumGrado/?periodoV=999999&programa=P-ICIV&plan=000012&nivel=GR
```

That fixture currently verifies 11 blocks, 70 subjects, and 239 credits for
Ingeniería Civil.
