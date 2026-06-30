import { describe, expect, it } from 'vitest';
import {
  advanceReviewTask,
  buildReportReviewIntake,
  createCurriculumReportInputSchema,
  reviewTaskSchema,
} from '../src/domain/report-review.js';

const validReportInput = {
  careerId: 'industrial-engineering',
  careerVersion: '2026.1.0',
  period: 4,
  subject: { subjectId: 'MAT-202' },
  issueType: 'credits' as const,
  description: 'The official source lists 6 credits, but the catalog shows 4.',
  sourceReference: 'Official curriculum PDF, page 7',
  reporterEmail: 'student@example.com',
  evidenceUrl: 'https://university.example/careers/engineering/curriculum.pdf',
};

describe('Create curriculum report input schema', () => {
  it('accepts report intake before persistence assigns an id', () => {
    const parsed = createCurriculumReportInputSchema.parse(validReportInput);

    expect(parsed.status).toBe('new');
    expect(parsed.reporterEmail).toBe('student@example.com');
  });

  it('rejects report intake without actionable evidence', () => {
    const result = createCurriculumReportInputSchema.safeParse({ ...validReportInput, description: '', sourceReference: '' });

    expect(result.success).toBe(false);
    expect(result.success === false ? result.error.issues.map((issue) => issue.path.join('.')) : []).toEqual(
      expect.arrayContaining(['description', 'sourceReference']),
    );
  });
});

describe('buildReportReviewIntake', () => {
  it('creates a new report with an open review task and audit event', () => {
    const intake = buildReportReviewIntake(validReportInput, {
      reportId: 'report_2026_0001',
      reviewTaskId: 'task_2026_0001',
      actor: 'student@example.com',
      occurredAt: '2026-06-30T12:00:00.000Z',
    });

    expect(intake.report).toMatchObject({
      id: 'report_2026_0001',
      status: 'new',
      reporterEmail: 'student@example.com',
    });
    expect(intake.reviewTask).toMatchObject({
      id: 'task_2026_0001',
      reportId: 'report_2026_0001',
      state: 'open',
    });
    expect(intake.auditEvent).toMatchObject({
      actor: 'student@example.com',
      action: 'report.intake.created',
      targetType: 'curriculum_report',
      targetId: 'report_2026_0001',
      outcome: 'succeeded',
    });
  });
});

describe('review task lifecycle', () => {
  const openTask = reviewTaskSchema.parse({
    id: 'task_2026_0001',
    reportId: 'report_2026_0001',
    state: 'open',
    createdAt: '2026-06-30T12:00:00.000Z',
  });

  it('starts review by assigning a reviewer', () => {
    const started = advanceReviewTask(openTask, {
      action: 'start_review',
      actor: 'reviewer@example.com',
      occurredAt: '2026-06-30T12:30:00.000Z',
    });

    expect(started.reviewTask).toMatchObject({
      state: 'in_review',
      assigneeId: 'reviewer@example.com',
    });
    expect(started.reportStatus).toBe('under_review');
  });

  it('resolves an in-review task with an outcome and closing note', () => {
    const inReview = {
      ...openTask,
      state: 'in_review' as const,
      assigneeId: 'reviewer@example.com',
    };

    const resolved = advanceReviewTask(inReview, {
      action: 'resolve',
      actor: 'reviewer@example.com',
      outcome: 'catalog_update_required',
      closingNote: 'Credits mismatch confirmed against official source.',
      occurredAt: '2026-06-30T13:00:00.000Z',
    });

    expect(resolved.reviewTask).toMatchObject({
      state: 'resolved',
      outcome: 'catalog_update_required',
      closingNote: 'Credits mismatch confirmed against official source.',
    });
    expect(resolved.reportStatus).toBe('resolved');
  });

  it('rejects resolving a task without reviewer evidence', () => {
    const result = () => advanceReviewTask(
      { ...openTask, state: 'in_review' as const, assigneeId: 'reviewer@example.com' },
      { action: 'resolve', actor: 'reviewer@example.com', outcome: 'not_reproducible', occurredAt: '2026-06-30T13:00:00.000Z' },
    );

    expect(result).toThrow(/closingNote/);
  });

  it('prevents reopening closed review tasks', () => {
    const closedTask = reviewTaskSchema.parse({
      ...openTask,
      state: 'closed',
      outcome: 'catalog_update_required',
      closingNote: 'Resolved and archived.',
      closedAt: '2026-06-30T14:00:00.000Z',
    });

    const result = () =>
      advanceReviewTask(closedTask, {
        action: 'start_review',
        actor: 'reviewer@example.com',
        occurredAt: '2026-06-30T15:00:00.000Z',
      });

    expect(result).toThrow(/closed/);
  });
});
