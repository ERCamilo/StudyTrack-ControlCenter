import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { buildN8nCandidateIntake, createIngestionRequestInputSchema } from '../domain/n8n-intake.js';
import { parseUasdPensumRows } from '../ingestion/uasd-pensum.js';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };

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

async function readJson(request: IncomingMessage) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify(body));
}

export function createControlCenterServer() {
  const store = {
    ingestionRequests: [] as Array<Record<string, unknown>>,
    sourceSnapshots: [] as Array<Record<string, unknown>>,
    candidates: [] as Array<Record<string, unknown>>,
    auditEvents: [] as Array<Record<string, unknown>>,
  };

  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') {
        send(response, 200, { ok: true });
        return;
      }

      if (request.method === 'POST' && request.url === '/api/ingestion-requests') {
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

      if (request.method === 'POST' && request.url === '/api/uasd/pensum-candidates') {
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
