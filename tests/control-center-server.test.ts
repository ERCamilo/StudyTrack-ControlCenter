import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createControlCenterServer } from '../src/server/control-center-server.js';

function readUasdFixture() {
  const text = readFileSync(new URL('./fixtures/uasd-p-iciv-000012-rows.tsv', import.meta.url), 'utf8');
  const lines = text.trim().split(/\r?\n/);
  return {
    sourceUrl: lines[0]?.replace('# sourceUrl=', ''),
    rows: lines.filter((line) => !line.startsWith('#')).map((line) => line.split('\t')),
  };
}

const fixture = readUasdFixture();
const servers: Array<{ close: () => Promise<void> }> = [];

async function startServer() {
  const app = createControlCenterServer();
  const running = await app.listen(0);
  servers.push(running);
  return { app, baseUrl: `http://127.0.0.1:${running.port}` };
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, json: await response.json() };
}

async function getJson(url: string) {
  const response = await fetch(url);
  return { response, json: await response.json() };
}

function uasdDraftInput(overrides: Record<string, unknown> = {}) {
  return {
    sourceUrl: fixture.sourceUrl,
    institution: 'Universidad Autónoma de Santo Domingo',
    careerName: 'Ingeniería Civil',
    programCode: 'P-ICIV',
    plan: '000012',
    expectedPeriods: 11,
    ...overrides,
  };
}

async function createUasdDraft(baseUrl: string, overrides: Record<string, unknown> = {}) {
  return postJson(`${baseUrl}/api/uasd/pensum-drafts`, uasdDraftInput(overrides));
}

async function startServerWithFailingN8nWebhook() {
  const n8n = createControlCenterServer();
  const n8nRunning = await n8n.listen(0);
  servers.push(n8nRunning);
  const app = createControlCenterServer({ n8nUasdWebhookUrl: `http://127.0.0.1:${n8nRunning.port}/missing` });
  const running = await app.listen(0);
  servers.push(running);
  return { app, baseUrl: `http://127.0.0.1:${running.port}` };
}

async function postValidUasdCandidate(baseUrl: string, requestId: string, overrides: Record<string, unknown> = {}) {
  return postJson(`${baseUrl}/api/uasd/pensum-candidates`, {
    requestId,
    workflowRunId: 'n8n-uasd-p-iciv-000012',
    source: {
      url: fixture.sourceUrl,
      capturedAt: '2026-06-30T12:00:00.000Z',
    },
    metadata: {
      careerName: 'Ingeniería Civil',
      institution: 'Universidad Autónoma de Santo Domingo',
      plan: '000012',
      programCode: 'P-ICIV',
    },
    rows: fixture.rows,
    ...overrides,
  });
}

afterEach(async () => {
  while (servers.length) await servers.pop()?.close();
});

describe('Control Center HTTP base', () => {
  it('serves university configuration for operator clients', async () => {
    const { baseUrl } = await startServer();
    const config = await getJson(`${baseUrl}/api/config/universities`);

    expect(config.response.status).toBe(200);
    expect(config.json.universities[0]).toMatchObject({
      id: 'uasd',
      name: 'Universidad Autónoma de Santo Domingo',
      supportedWorkflow: 'uasd-pensum-ingestion',
    });
  });

  it('creates UASD draft requests for n8n and blocks active duplicates', async () => {
    const { app, baseUrl } = await startServer();
    const input = {
      requestedBy: 'operator@example.com',
      notes: 'Initial load',
    };

    const draft = await createUasdDraft(baseUrl, input);
    const duplicate = await createUasdDraft(baseUrl, input);

    expect(draft.response.status).toBe(201);
    expect(draft.json.draft).toMatchObject({
      status: 'draft_requested',
      careerName: 'Ingeniería Civil',
      programCode: 'P-ICIV',
      plan: '000012',
    });
    expect(draft.json.n8n.dispatchStatus).toBe('not_configured');
    expect(draft.json.n8n.payload).toMatchObject({
      requestId: draft.json.ingestionRequest.id,
      sourceUrl: fixture.sourceUrl,
      expectedPeriods: 11,
    });
    expect(duplicate.response.status).toBe(409);
    expect(duplicate.json.error).toBe('duplicate_draft');
    expect(app.snapshot().drafts).toHaveLength(1);
  });

  it('lets operators edit, retry, discard, and publish valid UASD drafts', async () => {
    const { app, baseUrl } = await startServer();
    const draft = await createUasdDraft(baseUrl);
    const draftId = draft.json.draft.id;
    const requestId = draft.json.ingestionRequest.id;

    const edit = await fetch(`${baseUrl}/api/uasd/pensum-drafts/${draftId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ careerName: 'Ingeniería Civil Revisada' }),
    });
    const retry = await postJson(`${baseUrl}/api/uasd/pensum-drafts/${draftId}/retry`, {});
    const publishTooEarly = await postJson(`${baseUrl}/api/uasd/pensum-drafts/${draftId}/publish`, {});

    expect(edit.status).toBe(200);
    expect(retry.response.status).toBe(200);
    expect(retry.json.n8n.payload.requestId).toBe(requestId);
    expect(publishTooEarly.response.status).toBe(409);
    expect(publishTooEarly.json.error).toBe('valid_candidate_required');

    const candidate = await postValidUasdCandidate(baseUrl, requestId, {
      metadata: {
        careerName: 'Ingeniería Civil Revisada',
        institution: 'Universidad Autónoma de Santo Domingo',
        plan: '000012',
        programCode: 'P-ICIV',
      },
    });
    const publish = await postJson(`${baseUrl}/api/uasd/pensum-drafts/${draftId}/publish`, {});

    expect(candidate.response.status).toBe(202);
    expect(app.snapshot().drafts[0]?.status).toBe('published');
    expect(publish.response.status).toBe(200);
    expect(publish.json.draft.status).toBe('published');
  });

  it('rejects invalid draft lifecycle transitions', async () => {
    const { baseUrl } = await startServer();
    const draft = await createUasdDraft(baseUrl);
    const draftId = draft.json.draft.id;

    await postJson(`${baseUrl}/api/uasd/pensum-drafts/${draftId}/discard`, {});
    const retry = await postJson(`${baseUrl}/api/uasd/pensum-drafts/${draftId}/retry`, {});
    const discardAgain = await postJson(`${baseUrl}/api/uasd/pensum-drafts/${draftId}/discard`, {});
    const publish = await postJson(`${baseUrl}/api/uasd/pensum-drafts/${draftId}/publish`, {});
    const edit = await fetch(`${baseUrl}/api/uasd/pensum-drafts/${draftId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ careerName: 'Should Not Change' }),
    });

    expect(retry.response.status).toBe(409);
    expect(retry.json.error).toBe('terminal_draft_locked');
    expect(discardAgain.response.status).toBe(409);
    expect(discardAgain.json.error).toBe('terminal_draft_locked');
    expect(publish.response.status).toBe(409);
    expect(publish.json.error).toBe('terminal_draft_locked');
    expect(edit.status).toBe(409);
  });

  it('does not resurrect terminal drafts when n8n callbacks arrive later', async () => {
    const { app, baseUrl } = await startServer();
    const draft = await createUasdDraft(baseUrl);
    await postJson(`${baseUrl}/api/uasd/pensum-drafts/${draft.json.draft.id}/discard`, {});

    const callback = await postValidUasdCandidate(baseUrl, draft.json.ingestionRequest.id, {
      workflowRunId: 'late-n8n-callback',
    });

    expect(callback.response.status).toBe(202);
    expect(app.snapshot().drafts[0]?.status).toBe('discarded');
  });

  it('prevents patching an active draft into another active duplicate', async () => {
    const { baseUrl } = await startServer();
    await createUasdDraft(baseUrl);
    const second = await createUasdDraft(baseUrl, {
      sourceUrl: 'https://app.uasd.edu.do/PensumGrado/?periodoV=999999&programa=P-ARQ&plan=000001&nivel=GR',
      careerName: 'Arquitectura',
      programCode: 'P-ARQ',
      plan: '000001',
      expectedPeriods: 10,
    });

    const patch = await fetch(`${baseUrl}/api/uasd/pensum-drafts/${second.json.draft.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ programCode: 'P-ICIV', plan: '000012' }),
    });

    expect(patch.status).toBe(409);
    expect(await patch.json()).toMatchObject({ error: 'duplicate_draft' });
  });

  it('keeps draft creation successful when n8n dispatch fails', async () => {
    const { app, baseUrl } = await startServerWithFailingN8nWebhook();

    const draft = await createUasdDraft(baseUrl);
    const retry = await postJson(`${baseUrl}/api/uasd/pensum-drafts/${draft.json.draft.id}/retry`, {});

    expect(draft.response.status).toBe(201);
    expect(draft.json.n8n.dispatchStatus).toBe('failed');
    expect(draft.json.draft.status).toBe('dispatch_failed');
    expect(retry.response.status).toBe(200);
    expect(retry.json.n8n.dispatchStatus).toBe('failed');
    expect(retry.json.draft.status).toBe('dispatch_failed');
    expect(app.snapshot().drafts).toHaveLength(1);
  });

  it('allows a new draft after the previous matching draft is published', async () => {
    const { baseUrl } = await startServer();
    const first = await createUasdDraft(baseUrl);
    await postValidUasdCandidate(baseUrl, first.json.ingestionRequest.id);
    await postJson(`${baseUrl}/api/uasd/pensum-drafts/${first.json.draft.id}/publish`, {});

    const next = await createUasdDraft(baseUrl);

    expect(next.response.status).toBe(201);
  });

  it('lets operators discard drafts', async () => {
    const { app, baseUrl } = await startServer();
    const draft = await createUasdDraft(baseUrl);

    const discarded = await postJson(`${baseUrl}/api/uasd/pensum-drafts/${draft.json.draft.id}/discard`, {});

    expect(discarded.response.status).toBe(200);
    expect(discarded.json.draft.status).toBe('discarded');
    expect(app.snapshot().drafts[0]?.status).toBe('discarded');
  });

  it('accepts ingestion requests and UASD n8n candidate callbacks', async () => {
    const { app, baseUrl } = await startServer();
    const request = await postJson(`${baseUrl}/api/ingestion-requests`, {
      sourceUrl: fixture.sourceUrl,
      institution: 'Universidad Autónoma de Santo Domingo',
      careerName: 'Ingeniería Civil',
      degreeType: 'professional',
      expectedPeriods: 11,
      sourceType: 'official_page',
      requestedBy: 'maintainer@example.com',
    });

    expect(request.response.status).toBe(201);
    expect(request.json.ingestionRequest.status).toBe('requested');

    const candidate = await postJson(`${baseUrl}/api/uasd/pensum-candidates`, {
      requestId: request.json.ingestionRequest.id,
      workflowRunId: 'n8n-uasd-p-iciv-000012',
      source: {
        url: fixture.sourceUrl,
        capturedAt: '2026-06-30T12:00:00.000Z',
      },
      metadata: {
        careerName: 'Ingeniería Civil',
        institution: 'Universidad Autónoma de Santo Domingo',
        plan: '000012',
        programCode: 'P-ICIV',
      },
      rows: fixture.rows,
    });

    expect(candidate.response.status).toBe(202);
    expect(candidate.json.extractedCandidate.validationStatus).toBe('valid');
    expect(candidate.json.summary).toMatchObject({ periods: 11, subjects: 70, credits: 239 });
    expect(app.snapshot().candidates).toHaveLength(1);
    expect(app.snapshot().sourceSnapshots[0]?.contentHash).toMatch(/^sha256:/);
  });

  it('rejects malformed UASD callbacks without creating candidates', async () => {
    const { app, baseUrl } = await startServer();
    const result = await postJson(`${baseUrl}/api/uasd/pensum-candidates`, {
      requestId: '',
      rows: [],
    });

    expect(result.response.status).toBe(400);
    expect(result.json.error).toBe('invalid_request');
    expect(app.snapshot().candidates).toEqual([]);
  });
});
