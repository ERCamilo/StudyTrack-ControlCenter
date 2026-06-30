import { describe, expect, it } from 'vitest';
import {
  buildN8nCandidateIntake,
  createIngestionRequestInputSchema,
  n8nCandidateWebhookSchema,
} from '../src/domain/n8n-intake.js';

const validRequestInput = {
  sourceUrl: 'https://university.example/careers/engineering/curriculum.pdf',
  institution: 'University Example',
  careerName: 'Industrial Engineering',
  degreeType: 'professional',
  expectedPeriods: 10,
  sourceType: 'pdf',
  requestedBy: 'coordinator@example.com',
  notes: 'Official curriculum update for 2026.',
};

const validWebhookPayload = {
  requestId: 'req_2026_0001',
  workflowRunId: 'n8n_run_2026_0001',
  source: {
    url: 'https://university.example/careers/engineering/curriculum.pdf',
    contentHash: 'sha256:4b8f4d6fbc9d6f0a0f9b9270215c1f20c4b5fd1d77d9f509a8cfe2c0c9fef012',
    storageUrl: 's3://studytrack-control-center/snapshots/req_2026_0001.pdf',
    capturedAt: '2026-06-30T10:00:00.000Z',
  },
  candidate: {
    catalog: {
      carrera: 'Industrial Engineering',
      periodos: [{ numero: 1, ramos: [{ id: 'MAT-101', nombre: 'Calculus I' }] }],
    },
    validationErrors: [],
    confidence: 0.94,
  },
  receivedAt: '2026-06-30T10:05:00.000Z',
};

describe('Create ingestion request input schema', () => {
  it('accepts request metadata before persistence assigns an id', () => {
    const parsed = createIngestionRequestInputSchema.parse(validRequestInput);

    expect(parsed.status).toBe('requested');
    expect(parsed.sourceUrl).toBe(validRequestInput.sourceUrl);
  });

  it('rejects requests that cannot be dispatched to extraction', () => {
    const result = createIngestionRequestInputSchema.safeParse({
      ...validRequestInput,
      sourceUrl: 'not-a-url',
      expectedPeriods: 0,
    });

    expect(result.success).toBe(false);
    const paths = result.success === false ? result.error.issues.map((issue) => issue.path.join('.')) : [];
    expect(paths).toEqual(expect.arrayContaining(['sourceUrl', 'expectedPeriods']));
  });
});

describe('n8n candidate webhook schema', () => {
  it('accepts a candidate payload with source snapshot metadata', () => {
    const parsed = n8nCandidateWebhookSchema.parse(validWebhookPayload);

    expect(parsed.workflowRunId).toBe('n8n_run_2026_0001');
    expect(parsed.source.contentHash).toMatch(/^sha256:/);
    expect(parsed.candidate.validationErrors).toEqual([]);
  });

  it('rejects n8n payloads without a durable source hash', () => {
    const result = n8nCandidateWebhookSchema.safeParse({
      ...validWebhookPayload,
      source: {
        ...validWebhookPayload.source,
        contentHash: 'not-a-hash',
      },
    });

    expect(result.success).toBe(false);
    expect(result.success === false ? result.error.issues[0]?.path.join('.') : '').toBe('source.contentHash');
  });
});

describe('buildN8nCandidateIntake', () => {
  it('maps a webhook payload into source snapshot and extracted candidate records', () => {
    const intake = buildN8nCandidateIntake(validWebhookPayload);

    expect(intake.sourceSnapshot).toEqual({
      sourceUrl: validWebhookPayload.source.url,
      contentHash: validWebhookPayload.source.contentHash,
      storageUrl: validWebhookPayload.source.storageUrl,
      capturedAt: validWebhookPayload.source.capturedAt,
    });
    expect(intake.extractedCandidate).toMatchObject({
      requestId: validWebhookPayload.requestId,
      extractionMethod: 'n8n',
      confidence: 0.94,
      validationStatus: 'valid',
    });
    expect(intake.auditEvent).toMatchObject({
      actor: 'n8n',
      action: 'candidate.intake.received',
      targetType: 'ingestion_request',
      targetId: validWebhookPayload.requestId,
      outcome: 'succeeded',
    });
  });

  it('preserves validation errors so reviewers can triage failed extractions', () => {
    const intake = buildN8nCandidateIntake({
      ...validWebhookPayload,
      candidate: {
        ...validWebhookPayload.candidate,
        validationErrors: [{ path: 'periodos', message: 'At least one period is required', severity: 'error' }],
      },
    });

    expect(intake.extractedCandidate.validationStatus).toBe('invalid');
    expect(intake.auditEvent.metadata).toMatchObject({
      validationStatus: 'invalid',
      validationErrorCount: 1,
    });
  });
});
