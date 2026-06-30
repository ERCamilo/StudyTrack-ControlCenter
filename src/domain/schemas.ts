import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
const isoDateTime = z.string().datetime({ offset: true });

export const reportLifecycleStatusSchema = z.enum(['new', 'under_review', 'resolved', 'closed']);

export const reportSubjectSchema = z.union([
  z
    .object({
      subjectId: nonEmptyString,
      subjectText: nonEmptyString.optional(),
    })
    .strict(),
  z
    .object({
      subjectText: nonEmptyString,
    })
    .strict(),
]);

export const curriculumReportSchema = z
  .object({
    id: nonEmptyString.optional(),
    careerId: nonEmptyString,
    careerVersion: nonEmptyString,
    period: z.union([nonEmptyString, z.number().int().positive()]),
    subject: reportSubjectSchema,
    issueType: z.enum([
      'missing_subject',
      'extra_subject',
      'prerequisite',
      'credits',
      'code',
      'name',
      'outdated_source',
      'other',
    ]),
    description: nonEmptyString,
    sourceReference: nonEmptyString,
    reporterEmail: z.string().email().optional(),
    evidenceUrl: z.string().url().optional(),
    status: reportLifecycleStatusSchema.default('new'),
    submittedAt: isoDateTime.optional(),
  })
  .strict();

export const ingestionRequestStatusSchema = z.enum([
  'requested',
  'extracting',
  'candidate_ready',
  'validation_failed',
  'needs_review',
  'approved',
  'published',
  'rejected',
]);

export const ingestionRequestSchema = z
  .object({
    id: nonEmptyString,
    sourceUrl: z.string().url(),
    institution: nonEmptyString,
    careerName: nonEmptyString,
    degreeType: z.enum(['technical', 'professional', 'bachelor', 'master', 'doctorate', 'other']),
    expectedPeriods: z.number().int().positive(),
    sourceType: z.enum(['official_page', 'pdf', 'spreadsheet', 'image', 'user_submitted', 'other']),
    notes: nonEmptyString.optional(),
    status: ingestionRequestStatusSchema.default('requested'),
    requestedBy: nonEmptyString.optional(),
    requestedAt: isoDateTime.optional(),
  })
  .strict();

export const validationErrorSchema = z
  .object({
    path: nonEmptyString,
    message: nonEmptyString,
    severity: z.enum(['error', 'warning']),
  })
  .strict();

export const extractionMethodSchema = z.enum(['n8n', 'ocr', 'ai', 'manual']);

export const extractedCandidateSchema = z
  .object({
    id: nonEmptyString.optional(),
    requestId: nonEmptyString,
    sourceSnapshotId: nonEmptyString,
    extractedCatalogJson: z.unknown(),
    validationErrors: z.array(validationErrorSchema),
    extractionMethod: extractionMethodSchema,
    confidence: z.number().min(0).max(1).optional(),
    receivedAt: isoDateTime.optional(),
  })
  .strict()
  .transform((candidate) => ({
    ...candidate,
    validationStatus: candidate.validationErrors.some((error) => error.severity === 'error') ? 'invalid' : 'valid',
  }));

export const careerEditorialStatusSchema = z.enum([
  'added',
  'in_verification',
  'user_submitted',
  'updated',
  'failed',
  'published',
]);

export const careerVersionSchema = z
  .object({
    id: nonEmptyString,
    careerId: nonEmptyString,
    version: nonEmptyString,
    status: careerEditorialStatusSchema,
    sourceSnapshotId: nonEmptyString.optional(),
    createdBy: nonEmptyString,
    createdAt: isoDateTime.optional(),
    publishedAt: isoDateTime.optional(),
  })
  .strict();

export const publicationJobStatusSchema = z.enum([
  'pending_approval',
  'approved',
  'running',
  'published',
  'failed',
  'rejected',
]);

export const publicationJobSchema = z
  .object({
    id: nonEmptyString,
    careerVersionId: nonEmptyString,
    sourceSnapshotId: nonEmptyString,
    status: publicationJobStatusSchema,
    approvedBy: nonEmptyString.optional(),
    approvedAt: isoDateTime.optional(),
    executedAt: isoDateTime.optional(),
    artifactVersion: nonEmptyString.optional(),
    failureReason: nonEmptyString.optional(),
  })
  .strict()
  .superRefine((job, context) => {
    if (job.status === 'approved' && !job.approvedBy) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['approvedBy'],
        message: 'approvedBy is required when a publication job is approved.',
      });
    }
    if (job.status === 'approved' && !job.approvedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['approvedAt'],
        message: 'approvedAt is required when a publication job is approved.',
      });
    }
  });

export const auditEventSchema = z
  .object({
    id: nonEmptyString,
    actor: nonEmptyString,
    action: nonEmptyString,
    targetType: z.enum([
      'career',
      'career_version',
      'curriculum_report',
      'ingestion_request',
      'extracted_candidate',
      'source_snapshot',
      'publication_job',
      'review_task',
    ]),
    targetId: nonEmptyString,
    occurredAt: isoDateTime,
    outcome: z.enum(['allowed', 'denied', 'succeeded', 'failed']),
    reason: nonEmptyString.optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type CurriculumReport = z.infer<typeof curriculumReportSchema>;
export type IngestionRequest = z.infer<typeof ingestionRequestSchema>;
export type ExtractedCandidate = z.infer<typeof extractedCandidateSchema>;
export type CareerVersion = z.infer<typeof careerVersionSchema>;
export type PublicationJob = z.infer<typeof publicationJobSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
