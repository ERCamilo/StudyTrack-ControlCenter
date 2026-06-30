import { describe, expect, it } from 'vitest';
import {
  approvePublicationJob,
  buildPublishedCatalogArtifact,
  publicationApprovalInputSchema,
} from '../src/domain/publication-gate.js';

const validApprovalInput = {
  publicationJobId: 'job_2026_0001',
  careerVersionId: 'ver_2026_0001',
  sourceSnapshotId: 'snap_2026_0001',
  approver: 'maintainer@example.com',
  approvedAt: '2026-06-30T16:00:00.000Z',
  approvalNote: 'Official source verified and all review tasks are resolved.',
  artifactVersion: '2026.1.0',
  gate: {
    unresolvedReviewTasks: 0,
    validationErrorCount: 0,
  },
};

describe('publication approval input schema', () => {
  it('accepts a human approval when validation and review gates are clear', () => {
    const parsed = publicationApprovalInputSchema.parse(validApprovalInput);

    expect(parsed.gate.unresolvedReviewTasks).toBe(0);
    expect(parsed.approver).toBe('maintainer@example.com');
  });

  it('rejects approvals while unresolved review tasks remain', () => {
    const result = publicationApprovalInputSchema.safeParse({
      ...validApprovalInput,
      gate: { ...validApprovalInput.gate, unresolvedReviewTasks: 1 },
    });

    expect(result.success).toBe(false);
    expect(result.success === false ? result.error.issues[0]?.message : '').toContain('review tasks');
  });
});

describe('approvePublicationJob', () => {
  it('marks a publication job as approved with human approval metadata and audit evidence', () => {
    const approval = approvePublicationJob(validApprovalInput);

    expect(approval.publicationJob).toMatchObject({
      id: 'job_2026_0001',
      status: 'approved',
      approvedBy: 'maintainer@example.com',
      approvedAt: '2026-06-30T16:00:00.000Z',
      artifactVersion: '2026.1.0',
    });
    expect(approval.auditEvent).toMatchObject({
      actor: 'maintainer@example.com',
      action: 'publication.approved',
      targetType: 'publication_job',
      targetId: 'job_2026_0001',
      outcome: 'succeeded',
    });
  });

  it('rejects approval when extracted candidate validation errors remain', () => {
    expect(() =>
      approvePublicationJob({
        ...validApprovalInput,
        gate: { unresolvedReviewTasks: 0, validationErrorCount: 2 },
      }),
    ).toThrow(/validation errors/);
  });
});

describe('buildPublishedCatalogArtifact', () => {
  it('publishes an artifact only from an approved publication job', () => {
    const approval = approvePublicationJob(validApprovalInput);
    const publication = buildPublishedCatalogArtifact(approval.publicationJob, {
      artifactPath: 'library/industrial-engineering/2026.1.0.json',
      contentHash: 'sha256:4b8f4d6fbc9d6f0a0f9b9270215c1f20c4b5fd1d77d9f509a8cfe2c0c9fef012',
      publishedAt: '2026-06-30T16:30:00.000Z',
    });

    expect(publication.publicationJob).toMatchObject({
      status: 'published',
      executedAt: '2026-06-30T16:30:00.000Z',
    });
    expect(publication.catalogArtifact).toMatchObject({
      publicationJobId: 'job_2026_0001',
      version: '2026.1.0',
      artifactPath: 'library/industrial-engineering/2026.1.0.json',
    });
  });

  it('prevents publication when the job is still pending approval', () => {
    expect(() =>
      buildPublishedCatalogArtifact(
        {
          id: 'job_2026_0002',
          careerVersionId: 'ver_2026_0002',
          sourceSnapshotId: 'snap_2026_0002',
          status: 'pending_approval',
        },
        {
          artifactPath: 'library/example/2026.1.0.json',
          contentHash: 'sha256:4b8f4d6fbc9d6f0a0f9b9270215c1f20c4b5fd1d77d9f509a8cfe2c0c9fef013',
          publishedAt: '2026-06-30T17:00:00.000Z',
        },
      ),
    ).toThrow(/approved/);
  });
});
