import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { buildN8nCandidateIntake, createIngestionRequestInputSchema } from '../domain/n8n-intake.js';
import { parseUasdPensumRows } from '../ingestion/uasd-pensum.js';
import { renderControlCenterWizard } from './control-center-ui.js';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };
const htmlHeaders = { 'content-type': 'text/html; charset=utf-8' };

const uasdCandidateRequestSchema = z
  .object({
    requestId: z.string().trim().min(1),
    workflowRunId: z.string().trim().min(1),
    source: z
      .object({
        url: z.string().url(),
        capturedAt: z.string().datetime({ offset: true }),
      })
      .strict(),
    metadata: z
      .object({
        careerName: z.string().trim().min(1),
        institution: z.string().trim().min(1),
        plan: z.string().trim().min(1),
        programCode: z.string().trim().min(1),
      })
      .strict(),
    rows: z.array(z.array(z.string())),
  })
  .strict();

const uasdDraftRequestSchema = z
  .object({
    institution: z.literal('Universidad Autónoma de Santo Domingo'),
    careerName: z.string().trim().min(1),
    programCode: z.string().trim().min(1),
    plan: z.string().trim().min(1),
    sourceUrl: z.string().url(),
    expectedPeriods: z.number().int().positive(),
    requestedBy: z.string().email().optional().or(z.literal('')),
    notes: z.string().trim().optional(),
  })
  .strict();

const uasdDraftPatchSchema = uasdDraftRequestSchema.partial().omit({ institution: true });
const uasdCandidatePatchSchema = z
  .object({
    extractedCatalogJson: z.unknown(),
    validationErrors: z
      .array(
        z
          .object({
            path: z.string().trim().min(1),
            message: z.string().trim().min(1),
            severity: z.enum(['error', 'warning']),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
const terminalDraftStatuses = new Set(['discarded', 'published']);

async function readJson(request: IncomingMessage) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify(body));
}

function sendHtml(response: ServerResponse, html: string) {
  response.writeHead(200, htmlHeaders);
  response.end(html);
}

export function createControlCenterServer(options: { n8nUasdWebhookUrl?: string } = {}) {
  const store = {
    ingestionRequests: [] as Array<Record<string, unknown>>,
    drafts: [] as Array<Record<string, unknown>>,
    sourceSnapshots: [] as Array<Record<string, unknown>>,
    candidates: [] as Array<Record<string, unknown>>,
    auditEvents: [] as Array<Record<string, unknown>>,
  };

  const isActiveDraft = (draft: Record<string, unknown>) =>
    draft.status !== 'discarded' && draft.status !== 'published';

  const hasActiveDuplicate = (input: { institution?: string; programCode?: string; plan?: string }, exceptDraftId?: unknown) =>
    store.drafts.some(
      (draft) =>
        draft.id !== exceptDraftId &&
        draft.institution === (input.institution || 'Universidad Autónoma de Santo Domingo') &&
        draft.programCode === input.programCode &&
        draft.plan === input.plan &&
        isActiveDraft(draft),
    );

  const buildN8nPayload = (draft: Record<string, unknown>) => ({
    controlCenterBaseUrl: 'http://host.docker.internal:3000',
    requestId: draft.requestId,
    sourceUrl: draft.sourceUrl,
    institution: draft.institution,
    careerName: draft.careerName,
    plan: draft.plan,
    programCode: draft.programCode,
    expectedPeriods: draft.expectedPeriods,
  });

  const findCandidateForDraft = (draft: Record<string, unknown>) =>
    store.candidates.find((item) => item.requestId === draft.requestId);

  const summarizeCandidate = (candidate: Record<string, unknown>) => {
    const catalog = candidate.extractedCatalogJson as { periods?: Array<{ subjects?: Array<{ credits?: number }> }> };
    const periods = Array.isArray(catalog?.periods) ? catalog.periods : [];
    const subjects = periods.flatMap((period) => (Array.isArray(period.subjects) ? period.subjects : []));
    return {
      periods: periods.length,
      subjects: subjects.length,
      credits: subjects.reduce((total, subject) => total + Number(subject.credits || 0), 0),
      validationStatus: candidate.validationStatus,
      validationErrors: candidate.validationErrors,
    };
  };

  const dispatchToN8n = async (payload: Record<string, unknown>) => {
    if (!options.n8nUasdWebhookUrl) return 'not_configured' as const;
    try {
      const result = await fetch(options.n8nUasdWebhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!result.ok) return 'failed' as const;
      return 'sent' as const;
    } catch {
      return 'failed' as const;
    }
  };

  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;

      if (request.method === 'GET' && pathname === '/') {
        sendHtml(response, renderControlCenterWizard());
        return;
      }

      if (request.method === 'GET' && pathname === '/health') {
        send(response, 200, { ok: true });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/config/universities') {
        send(response, 200, {
          universities: [
            {
              id: 'uasd',
              name: 'Universidad Autónoma de Santo Domingo',
              supportedSourceTypes: ['official_page'],
              supportedWorkflow: 'uasd-pensum-ingestion',
            },
          ],
        });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/ingestion-requests') {
        const input = createIngestionRequestInputSchema.parse(await readJson(request));
        const ingestionRequest = {
          id: `req_${String(store.ingestionRequests.length + 1).padStart(6, '0')}`,
          ...input,
          requestedAt: new Date().toISOString(),
        };
        store.ingestionRequests.push(ingestionRequest);
        send(response, 201, { ingestionRequest });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/uasd/pensum-drafts') {
        send(response, 200, { drafts: store.drafts });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/uasd/pensum-drafts') {
        const input = uasdDraftRequestSchema.parse(await readJson(request));
        if (hasActiveDuplicate(input)) {
          send(response, 409, { error: 'duplicate_draft', details: 'This UASD program and plan already has an active draft.' });
          return;
        }

        const ingestionRequest = {
          id: `req_${String(store.ingestionRequests.length + 1).padStart(6, '0')}`,
          sourceUrl: input.sourceUrl,
          institution: input.institution,
          careerName: input.careerName,
          degreeType: 'professional',
          expectedPeriods: input.expectedPeriods,
          sourceType: 'official_page',
          notes: input.notes || undefined,
          status: 'requested',
          requestedBy: input.requestedBy || 'control-center-wizard',
          requestedAt: new Date().toISOString(),
        };
        store.ingestionRequests.push(ingestionRequest);

        const draft = {
          id: `draft_${String(store.drafts.length + 1).padStart(6, '0')}`,
          requestId: ingestionRequest.id,
          status: 'draft_requested',
          institution: input.institution,
          careerName: input.careerName,
          programCode: input.programCode,
          plan: input.plan,
          sourceUrl: input.sourceUrl,
          expectedPeriods: input.expectedPeriods,
          createdAt: new Date().toISOString(),
        };
        store.drafts.push(draft);

        const payload = buildN8nPayload(draft);
        const dispatchStatus = await dispatchToN8n(payload);
        if (dispatchStatus === 'failed') {
          Object.assign(draft, { status: 'dispatch_failed', dispatchFailedAt: new Date().toISOString() });
        }

        send(response, 201, { draft, ingestionRequest, n8n: { dispatchStatus, payload } });
        return;
      }

      const draftActionMatch = pathname.match(/^\/api\/uasd\/pensum-drafts\/([^/]+)(?:\/([^/]+))?$/);
      if (draftActionMatch) {
        const [, draftId, action] = draftActionMatch;
        const draft = store.drafts.find((item) => item.id === draftId);
        if (!draft) {
          send(response, 404, { error: 'draft_not_found' });
          return;
        }

        if (request.method === 'GET' && action === 'review') {
          const candidate = findCandidateForDraft(draft);
          if (!candidate) {
            send(response, 404, { error: 'candidate_not_found' });
            return;
          }
          send(response, 200, { draft, candidate, summary: summarizeCandidate(candidate) });
          return;
        }

        if (request.method === 'PATCH' && action === 'candidate') {
          if (terminalDraftStatuses.has(String(draft.status))) {
            send(response, 409, { error: 'terminal_draft_locked' });
            return;
          }
          const candidate = findCandidateForDraft(draft);
          if (!candidate) {
            send(response, 404, { error: 'candidate_not_found' });
            return;
          }
          const input = uasdCandidatePatchSchema.parse(await readJson(request));
          const validationErrors = input.validationErrors || (candidate.validationErrors as unknown[]);
          Object.assign(candidate, {
            extractedCatalogJson: input.extractedCatalogJson,
            validationErrors,
            validationStatus: validationErrors.some((error) => (error as { severity?: unknown }).severity === 'error')
              ? 'invalid'
              : 'valid',
            editedAt: new Date().toISOString(),
          });
          send(response, 200, { draft, candidate, summary: summarizeCandidate(candidate) });
          return;
        }

        if (request.method === 'PATCH' && !action) {
          if (terminalDraftStatuses.has(String(draft.status))) {
            send(response, 409, { error: 'terminal_draft_locked' });
            return;
          }
          const input = uasdDraftPatchSchema.parse(await readJson(request));
          if (
            (input.programCode || input.plan) &&
            hasActiveDuplicate(
              {
                institution: String(draft.institution),
                programCode: input.programCode || String(draft.programCode),
                plan: input.plan || String(draft.plan),
              },
              draft.id,
            )
          ) {
            send(response, 409, { error: 'duplicate_draft' });
            return;
          }
          Object.assign(draft, {
            ...input,
            updatedAt: new Date().toISOString(),
          });
          send(response, 200, { draft });
          return;
        }

        if (request.method === 'POST' && action === 'retry') {
          if (terminalDraftStatuses.has(String(draft.status))) {
            send(response, 409, { error: 'terminal_draft_locked' });
            return;
          }
          const payload = buildN8nPayload(draft);
          const dispatchStatus = await dispatchToN8n(payload);
          const retriedAt = new Date().toISOString();
          Object.assign(
            draft,
            dispatchStatus === 'failed'
              ? { status: 'dispatch_failed', retriedAt, dispatchFailedAt: retriedAt }
              : { status: 'draft_requested', retriedAt },
          );
          send(response, 200, { draft, n8n: { dispatchStatus, payload } });
          return;
        }

        if (request.method === 'POST' && action === 'discard') {
          if (terminalDraftStatuses.has(String(draft.status))) {
            send(response, 409, { error: 'terminal_draft_locked' });
            return;
          }
          Object.assign(draft, { status: 'discarded', discardedAt: new Date().toISOString() });
          send(response, 200, { draft });
          return;
        }

        if (request.method === 'POST' && action === 'publish') {
          if (terminalDraftStatuses.has(String(draft.status))) {
            send(response, 409, { error: 'terminal_draft_locked' });
            return;
          }
          const candidate = store.candidates.find(
            (item) => item.requestId === draft.requestId && item.validationStatus === 'valid',
          );
          if (!candidate) {
            send(response, 409, { error: 'valid_candidate_required' });
            return;
          }
          Object.assign(draft, { status: 'published', publishedAt: new Date().toISOString() });
          send(response, 200, { draft, candidate });
          return;
        }
      }

      if (request.method === 'POST' && pathname === '/api/uasd/pensum-candidates') {
        const input = uasdCandidateRequestSchema.parse(await readJson(request));
        const parsed = parseUasdPensumRows(input.rows, {
          ...input.metadata,
          sourceUrl: input.source.url,
        });
        const intake = buildN8nCandidateIntake({
          requestId: input.requestId,
          workflowRunId: input.workflowRunId,
          source: {
            url: input.source.url,
            contentHash: parsed.contentHash,
            capturedAt: input.source.capturedAt,
          },
          candidate: {
            catalog: parsed.catalog,
            validationErrors: parsed.validationErrors,
            confidence: parsed.validationErrors.length ? 0.6 : 0.95,
          },
          receivedAt: new Date().toISOString(),
        });
        store.sourceSnapshots.push(intake.sourceSnapshot);
        store.candidates.push(intake.extractedCandidate);
        store.auditEvents.push(intake.auditEvent);
        const draft = store.drafts.find((item) => item.requestId === input.requestId);
        if (draft && !terminalDraftStatuses.has(String(draft.status))) {
          Object.assign(draft, {
            status: intake.extractedCandidate.validationStatus === 'valid' ? 'candidate_ready' : 'needs_review',
            candidateReceivedAt: new Date().toISOString(),
          });
        }
        send(response, 202, {
          ...intake,
          summary: { periods: parsed.catalog.periods.length, subjects: parsed.subjectCount, credits: parsed.totalCredits },
        });
        return;
      }

      send(response, 404, { error: 'not_found' });
    } catch (error) {
      send(response, 400, { error: 'invalid_request', details: error instanceof Error ? error.message : String(error) });
    }
  });

  return {
    listen: (port = 0, host = '127.0.0.1') =>
      new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
        server.listen(port, host, () => {
          const address = server.address();
          resolve({
            port: typeof address === 'object' && address ? address.port : port,
            close: () => new Promise<void>((done) => server.close(() => done())),
          });
        });
      }),
    snapshot: () => structuredClone(store),
  };
}
