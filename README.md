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
npm install
npm run test:schema
npm test
npm run typecheck
npm run db:validate
npm run server:dev
```

If npm cannot write to the default user cache on Windows, use a project-local cache:

```bash
npm install --cache ./.npm-cache
```

`npm run db:validate` requires `DATABASE_URL` to be set. A local placeholder is
enough for schema validation:

```bash
DATABASE_URL="postgresql://user:password@localhost:5432/studytrack_control_center" npm run db:validate
```

## Functional local intake flow

Start the Control Center API:

```bash
npm run server:dev
```

The local API exposes:

- `GET /health`
- `POST /api/ingestion-requests`
- `POST /api/uasd/pensum-candidates`

The n8n workflow at `n8n/workflows/uasd-pensum-ingestion.json` can be imported
into n8n. It creates a Control Center ingestion request, fetches the UASD Civil
Engineering pensum URL, extracts table rows, and posts the parsed candidate back
to `/api/uasd/pensum-candidates`.

The UASD page may return an anti-bot challenge to server-side HTTP clients. The
parser is covered with a captured browser fixture from:

```text
https://app.uasd.edu.do/PensumGrado/?periodoV=999999&programa=P-ICIV&plan=000012&nivel=GR
```

That fixture currently verifies 11 blocks, 70 subjects, and 239 credits for
Ingeniería Civil.
