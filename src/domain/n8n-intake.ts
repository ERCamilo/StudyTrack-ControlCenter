import { z } from 'zod';
import {
  auditEventSchema,
  extractedCandidateSchema,
  ingestionRequestSchema,
  validationErrorSchema,
} from './schemas.js';

const sha256Hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const isoDateTime = z.string().datetime({ offset: true });

export const createIngestionRequestInputSchema = ingestionRequestSchema
  .omit({
    id: true,
    requestedAt: true,
  })
  .extend({
    status: z.literal('requested').default('requested'),
  })
  .strict();

export const n8nCandidateWebhookSchema = z
  .object({
    requestId: z.string().trim().min(1),
    workflowRunId: z.string().trim().min(1),
    source: z
      .object({
        url: z.string().url(),
        contentHash: sha256Hash,
        storageUrl: z.string().trim().min(1).optional(),
        capturedAt: isoDateTime,
      })
      .strict(),
    candidate: z
      .object({
        catalog: z.unknown(),
        validationErrors: z.array(validationErrorSchema),
        confidence: z.number().min(0).max(1).optional(),
      })
      .strict(),
    receivedAt: isoDateTime,
  })
  .strict();

export type CreateIngestionRequestInput = z.infer<typeof createIngestionRequestInputSchema>;
export type N8nCandidateWebhook = z.infer<typeof n8nCandidateWebhookSchema>;

const sourceSnapshotIdFromHash = (contentHash: string) => `snap_${contentHash.replace('sha256:', '').slice(0, 16)}`;

export function buildN8nCandidateIntake(payload: N8nCandidateWebhook) {
  const parsed = n8nCandidateWebhookSchema.parse(payload);
  const sourceSnapshotId = sourceSnapshotIdFromHash(parsed.source.contentHash);
  const candidate = extractedCandidateSchema.parse({
    requestId: parsed.requestId,
    sourceSnapshotId,
    extractedCatalogJson: parsed.candidate.catalog,
    validationErrors: parsed.candidate.validationErrors,
    extractionMethod: 'n8n',
    confidence: parsed.candidate.confidence,
    receivedAt: parsed.receivedAt,
  });

  const validationStatus = candidate.validationStatus;

  return {
    sourceSnapshot: {
      sourceUrl: parsed.source.url,
      contentHash: parsed.source.contentHash,
      storageUrl: parsed.source.storageUrl,
      capturedAt: parsed.source.capturedAt,
    },
    extractedCandidate: {
      ...candidate,
      workflowRunId: parsed.workflowRunId,
    },
    auditEvent: auditEventSchema.parse({
      id: `audit_${parsed.workflowRunId}`,
      actor: 'n8n',
      action: 'candidate.intake.received',
      targetType: 'ingestion_request',
      targetId: parsed.requestId,
      occurredAt: parsed.receivedAt,
      outcome: validationStatus === 'valid' ? 'succeeded' : 'failed',
      metadata: {
        workflowRunId: parsed.workflowRunId,
        sourceSnapshotId,
        validationStatus,
        validationErrorCount: parsed.candidate.validationErrors.length,
      },
    }),
  };
}
