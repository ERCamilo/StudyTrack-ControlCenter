import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  auditEventSchema,
  careerVersionSchema,
  curriculumReportSchema,
  extractedCandidateSchema,
  ingestionRequestSchema,
  publicationJobSchema,
  uasdPensumDraftSchema,
} from '../src/domain/schemas.js';
import { jsonSchemas } from '../src/domain/json-schemas.js';

const validReport = {
  careerId: 'industrial-engineering',
  careerVersion: '2026.1.0',
  period: 3,
  subject: { subjectId: 'MAT-201' },
  issueType: 'prerequisite',
  description: 'Calculus II should require Calculus I.',
  sourceReference: 'Official 2026 curriculum PDF, page 4',
};

describe('CurriculumReport schema', () => {
  it('accepts a complete report linked to a catalog subject', () => {
    const parsed = curriculumReportSchema.parse(validReport);

    expect(parsed.status).toBe('new');
    expect(parsed.subject).toEqual({ subjectId: 'MAT-201' });
  });

  it('preserves unknown subject text for reviewer triage', () => {
    const parsed = curriculumReportSchema.parse({
      ...validReport,
      subject: { subjectText: 'Taller Integrador missing from the current catalog' },
      issueType: 'missing_subject',
    });

    expect(parsed.subject).toEqual({
      subjectText: 'Taller Integrador missing from the current catalog',
    });
    expect(parsed.status).toBe('new');
  });

  it('rejects a report without a subject reference or subject text', () => {
    const result = curriculumReportSchema.safeParse({
      ...validReport,
      subject: {},
    });

    expect(result.success).toBe(false);
    expect(result.success === false ? result.error.issues[0]?.path : []).toContain('subject');
  });
});

describe('IngestionRequest schema', () => {
  it('accepts a complete request and defaults it to requested', () => {
    const parsed = ingestionRequestSchema.parse({
      id: 'req_2026_0001',
      sourceUrl: 'https://university.example/careers/engineering/curriculum.pdf',
      institution: 'University Example',
      careerName: 'Industrial Engineering',
      degreeType: 'professional',
      expectedPeriods: 10,
      sourceType: 'pdf',
      notes: 'Official source submitted by an authorized coordinator.',
    });

    expect(parsed.status).toBe('requested');
    expect(parsed.expectedPeriods).toBe(10);
  });

  it('rejects invalid URLs and missing metadata with field-level paths', () => {
    const result = ingestionRequestSchema.safeParse({
      id: 'req_2026_0002',
      sourceUrl: 'not-a-url',
      institution: '',
      careerName: '',
      degreeType: 'professional',
      expectedPeriods: 0,
      sourceType: 'pdf',
    });

    expect(result.success).toBe(false);
    const paths = result.success === false ? result.error.issues.map((issue) => issue.path.join('.')) : [];
    expect(paths).toEqual(expect.arrayContaining(['sourceUrl', 'institution', 'careerName', 'expectedPeriods']));
  });
});

describe('ExtractedCandidate schema', () => {
  it('stores valid candidate data linked to request and source snapshot', () => {
    const parsed = extractedCandidateSchema.parse({
      id: 'cand_2026_0001',
      requestId: 'req_2026_0001',
      sourceSnapshotId: 'snap_2026_0001',
      extractedCatalogJson: {
        carrera: 'Industrial Engineering',
        periodos: [{ numero: 1, ramos: [{ id: 'MAT-101', nombre: 'Calculus I' }] }],
      },
      validationErrors: [],
      extractionMethod: 'n8n',
      confidence: 0.92,
    });

    expect(parsed.validationStatus).toBe('valid');
    expect(parsed.confidence).toBe(0.92);
  });

  it('keeps validation errors for incomplete candidates', () => {
    const parsed = extractedCandidateSchema.parse({
      id: 'cand_2026_0002',
      requestId: 'req_2026_0001',
      sourceSnapshotId: 'snap_2026_0001',
      extractedCatalogJson: { carrera: 'Incomplete Plan' },
      validationErrors: [{ path: 'periodos', message: 'At least one period is required', severity: 'error' }],
      extractionMethod: 'ocr',
    });

    expect(parsed.validationStatus).toBe('invalid');
    expect(parsed.validationErrors[0]).toEqual({
      path: 'periodos',
      message: 'At least one period is required',
      severity: 'error',
    });
  });
});

describe('UasdPensumDraft schema', () => {
  it('tracks the operator draft lifecycle for UASD pensum ingestion', () => {
    const parsed = uasdPensumDraftSchema.parse({
      id: 'draft_2026_0001',
      requestId: 'req_2026_0001',
      institution: 'Universidad Autónoma de Santo Domingo',
      careerName: 'Ingeniería Civil',
      programCode: 'P-ICIV',
      plan: '000012',
      sourceUrl: 'https://app.uasd.edu.do/PensumGrado/?periodoV=999999&programa=P-ICIV&plan=000012&nivel=GR',
      expectedPeriods: 11,
    });

    expect(parsed.status).toBe('draft_requested');
    expect(parsed.programCode).toBe('P-ICIV');
  });
});

describe('Lifecycle and publication schemas', () => {
  it('tracks career editorial state and version metadata', () => {
    const parsed = careerVersionSchema.parse({
      id: 'ver_2026_0001',
      careerId: 'industrial-engineering',
      version: '2026.1.0',
      status: 'in_verification',
      sourceSnapshotId: 'snap_2026_0001',
      createdBy: 'maintainer@example.com',
    });

    expect(parsed.status).toBe('in_verification');
    expect(parsed.version).toBe('2026.1.0');
  });

  it('requires human approval before publication jobs become approved', () => {
    const pending = publicationJobSchema.parse({
      id: 'job_2026_0001',
      careerVersionId: 'ver_2026_0001',
      sourceSnapshotId: 'snap_2026_0001',
      status: 'pending_approval',
    });

    const approved = publicationJobSchema.parse({
      ...pending,
      status: 'approved',
      approvedBy: 'maintainer@example.com',
      approvedAt: '2026-06-29T12:00:00.000Z',
    });

    expect(pending.approvedBy).toBeUndefined();
    expect(approved.approvedBy).toBe('maintainer@example.com');
  });

  it('rejects approved publication jobs without a human approver', () => {
    const result = publicationJobSchema.safeParse({
      id: 'job_2026_0002',
      careerVersionId: 'ver_2026_0001',
      sourceSnapshotId: 'snap_2026_0001',
      status: 'approved',
    });

    expect(result.success).toBe(false);
    expect(result.success === false ? result.error.issues[0]?.message : '').toContain('approvedBy');
  });

  it('records denied attempts as audit events', () => {
    const parsed = auditEventSchema.parse({
      id: 'audit_2026_0001',
      actor: 'reviewer@example.com',
      action: 'publication.approve.denied',
      targetType: 'publication_job',
      targetId: 'job_2026_0001',
      occurredAt: '2026-06-29T12:30:00.000Z',
      outcome: 'denied',
      reason: 'Actor lacks publication approval permission.',
    });

    expect(parsed.outcome).toBe('denied');
    expect(parsed.reason).toBe('Actor lacks publication approval permission.');
  });
});

describe('JSON Schema exports', () => {
  it('exports JSON Schema definitions for public contracts', () => {
    expect(Object.keys(jsonSchemas)).toEqual(
      expect.arrayContaining([
        'CurriculumReport',
        'CreateCurriculumReportInput',
        'ReviewTask',
        'IngestionRequest',
        'CreateIngestionRequestInput',
        'N8nCandidateWebhook',
        'ExtractedCandidate',
        'UasdPensumDraft',
        'CareerVersion',
        'PublicationJob',
        'PublicationApprovalInput',
        'AuditEvent',
      ]),
    );
    expect(jsonSchemas.CurriculumReport.$schema).toBe('http://json-schema.org/draft-07/schema#');
  });
});

describe('Database schema stubs', () => {
  it('defines migration-ready persistence models for governed records', () => {
    const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');

    expect(schema).toContain('model Career ');
    expect(schema).toContain('model CurriculumReport ');
    expect(schema).toContain('reporterEmail');
    expect(schema).toContain('enum ReviewTaskState');
    expect(schema).toContain('model IngestionRequest ');
    expect(schema).toContain('model ExtractedCandidate ');
    expect(schema).toContain('workflowRunId');
    expect(schema).toContain('model UasdPensumDraft ');
    expect(schema).toContain('enum UasdPensumDraftStatus');
    expect(schema).toContain('@@index([institution, programCode, plan, status])');
    expect(schema).toContain('model SourceSnapshot ');
    expect(schema).toContain('model PublicationJob ');
    expect(schema).toContain('approvalNote');
    expect(schema).toContain('model AuditEvent ');
  });
});
