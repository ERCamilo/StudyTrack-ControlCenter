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

afterEach(async () => {
  while (servers.length) await servers.pop()?.close();
});

describe('Control Center HTTP base', () => {
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
