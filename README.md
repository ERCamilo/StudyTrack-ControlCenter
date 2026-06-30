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
npm run typecheck
npm run db:validate
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
