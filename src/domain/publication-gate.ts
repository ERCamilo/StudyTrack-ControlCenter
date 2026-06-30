import { z } from 'zod';
import { auditEventSchema, publicationJobSchema } from './schemas.js';

const nonEmptyString = z.string().trim().min(1);
const isoDateTime = z.string().datetime({ offset: true });
const sha256Hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const publicationGateSchema = z
  .object({
    unresolvedReviewTasks: z.number().int().min(0),
    validationErrorCount: z.number().int().min(0),
  })
  .strict();

export const publicationApprovalInputSchema = z
  .object({
    publicationJobId: nonEmptyString,
    careerVersionId: nonEmptyString,
    sourceSnapshotId: nonEmptyString,
    approver: z.string().email(),
    approvedAt: isoDateTime,
    approvalNote: nonEmptyString,
    artifactVersion: nonEmptyString,
    gate: publicationGateSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.gate.unresolvedReviewTasks > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gate', 'unresolvedReviewTasks'],
        message: 'Cannot approve publication while unresolved review tasks remain.',
      });
    }
    if (input.gate.validationErrorCount > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gate', 'validationErrorCount'],
        message: 'Cannot approve publication while candidate validation errors remain.',
      });
    }
  });

const catalogArtifactInputSchema = z
  .object({
    artifactPath: nonEmptyString,
    contentHash: sha256Hash,
    publishedAt: isoDateTime,
  })
  .strict();

export type PublicationApprovalInput = z.input<typeof publicationApprovalInputSchema>;
export type CatalogArtifactInput = z.input<typeof catalogArtifactInputSchema>;

export function approvePublicationJob(input: PublicationApprovalInput) {
  const approval = publicationApprovalInputSchema.parse(input);

  return {
    publicationJob: publicationJobSchema.parse({
      id: approval.publicationJobId,
      careerVersionId: approval.careerVersionId,
      sourceSnapshotId: approval.sourceSnapshotId,
      status: 'approved',
      approvedBy: approval.approver,
      approvedAt: approval.approvedAt,
      artifactVersion: approval.artifactVersion,
      approvalNote: approval.approvalNote,
    }),
    auditEvent: auditEventSchema.parse({
      id: `audit_${approval.publicationJobId}_approved`,
      actor: approval.approver,
      action: 'publication.approved',
      targetType: 'publication_job',
      targetId: approval.publicationJobId,
      outcome: 'succeeded',
      occurredAt: approval.approvedAt,
      metadata: {
        artifactVersion: approval.artifactVersion,
        approvalNote: approval.approvalNote,
      },
    }),
  };
}

export function buildPublishedCatalogArtifact(
  job: z.input<typeof publicationJobSchema>,
  artifactInput: CatalogArtifactInput,
) {
  const publicationJob = publicationJobSchema.parse(job);
  const artifact = catalogArtifactInputSchema.parse(artifactInput);

  if (publicationJob.status !== 'approved') {
    throw new Error('Publication job must be approved before publishing an artifact.');
  }

  const version = publicationJob.artifactVersion;
  if (!version) {
    throw new Error('artifactVersion is required before publishing an artifact.');
  }

  return {
    publicationJob: publicationJobSchema.parse({
      ...publicationJob,
      status: 'published',
      executedAt: artifact.publishedAt,
    }),
    catalogArtifact: {
      publicationJobId: publicationJob.id,
      version,
      artifactPath: artifact.artifactPath,
      contentHash: artifact.contentHash,
      createdAt: artifact.publishedAt,
    },
    auditEvent: auditEventSchema.parse({
      id: `audit_${publicationJob.id}_published`,
      actor: publicationJob.approvedBy,
      action: 'publication.published',
      targetType: 'publication_job',
      targetId: publicationJob.id,
      outcome: 'succeeded',
      occurredAt: artifact.publishedAt,
      metadata: {
        artifactPath: artifact.artifactPath,
        contentHash: artifact.contentHash,
      },
    }),
  };
}
