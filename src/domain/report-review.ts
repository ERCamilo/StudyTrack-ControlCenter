import { z } from 'zod';
import { auditEventSchema, curriculumReportSchema } from './schemas.js';

const nonEmptyString = z.string().trim().min(1);
const isoDateTime = z.string().datetime({ offset: true });

export const createCurriculumReportInputSchema = curriculumReportSchema
  .omit({ id: true, submittedAt: true })
  .extend({
    status: z.literal('new').default('new'),
    reporterEmail: z.string().email().optional(),
    evidenceUrl: z.string().url().optional(),
  })
  .strict();

export const reviewTaskStateSchema = z.enum(['open', 'in_review', 'resolved', 'closed']);
export const reviewTaskOutcomeSchema = z.enum(['catalog_update_required', 'not_reproducible', 'duplicate', 'out_of_scope']);

export const reviewTaskSchema = z
  .object({
    id: nonEmptyString,
    reportId: nonEmptyString,
    assigneeId: nonEmptyString.optional(),
    state: reviewTaskStateSchema.default('open'),
    outcome: reviewTaskOutcomeSchema.optional(),
    closingNote: nonEmptyString.optional(),
    createdAt: isoDateTime.optional(),
    closedAt: isoDateTime.optional(),
  })
  .strict()
  .superRefine((task, context) => {
    if ((task.state === 'resolved' || task.state === 'closed') && !task.outcome) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['outcome'],
        message: 'outcome is required when a review task is resolved or closed.',
      });
    }
    if ((task.state === 'resolved' || task.state === 'closed') && !task.closingNote) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['closingNote'],
        message: 'closingNote is required when a review task is resolved or closed.',
      });
    }
  });

const reviewTransitionSchema = z
  .discriminatedUnion('action', [
    z
      .object({
        action: z.literal('start_review'),
        actor: nonEmptyString,
        occurredAt: isoDateTime,
      })
      .strict(),
    z
      .object({
        action: z.literal('resolve'),
        actor: nonEmptyString,
        outcome: reviewTaskOutcomeSchema,
        closingNote: nonEmptyString.optional(),
        occurredAt: isoDateTime,
      })
      .strict(),
    z
      .object({
        action: z.literal('close'),
        actor: nonEmptyString,
        occurredAt: isoDateTime,
      })
      .strict(),
  ])
  .superRefine((transition, context) => {
    if (transition.action === 'resolve' && !transition.closingNote) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['closingNote'],
        message: 'closingNote is required when resolving a review task.',
      });
    }
  });

export type CreateCurriculumReportInput = z.input<typeof createCurriculumReportInputSchema>;
export type ReviewTask = z.infer<typeof reviewTaskSchema>;
export type ReviewTransition = z.input<typeof reviewTransitionSchema>;

export function buildReportReviewIntake(
  input: CreateCurriculumReportInput,
  options: {
    reportId: string;
    reviewTaskId: string;
    actor: string;
    occurredAt: string;
  },
) {
  const parsed = createCurriculumReportInputSchema.parse(input);

  return {
    report: { id: options.reportId, ...parsed },
    reviewTask: reviewTaskSchema.parse({
      id: options.reviewTaskId,
      reportId: options.reportId,
      state: 'open',
      createdAt: options.occurredAt,
    }),
    auditEvent: auditEventSchema.parse({
      id: `audit_${options.reviewTaskId}`,
      actor: options.actor,
      action: 'report.intake.created',
      targetType: 'curriculum_report',
      targetId: options.reportId,
      outcome: 'succeeded',
      occurredAt: options.occurredAt,
      metadata: {
        issueType: parsed.issueType,
        careerId: parsed.careerId,
        careerVersion: parsed.careerVersion,
      },
    }),
  };
}

export function advanceReviewTask(task: ReviewTask, transition: ReviewTransition) {
  const current = reviewTaskSchema.parse(task);
  const parsedTransition = reviewTransitionSchema.parse(transition);

  if (current.state === 'closed') {
    throw new Error('Cannot transition a closed review task.');
  }

  if (parsedTransition.action === 'start_review') {
    if (current.state !== 'open') {
      throw new Error('Only open review tasks can start review.');
    }

    return {
      reviewTask: reviewTaskSchema.parse({
        ...current,
        state: 'in_review',
        assigneeId: parsedTransition.actor,
      }),
      reportStatus: 'under_review' as const,
      auditEvent: auditEventSchema.parse({
        id: `audit_${current.id}_start`,
        actor: parsedTransition.actor,
        action: 'review_task.started',
        targetType: 'review_task',
        targetId: current.id,
        outcome: 'succeeded',
        occurredAt: parsedTransition.occurredAt,
      }),
    };
  }

  if (parsedTransition.action === 'resolve') {
    if (current.state !== 'in_review') {
      throw new Error('Only in-review tasks can be resolved.');
    }

    return {
      reviewTask: reviewTaskSchema.parse({
        ...current,
        state: 'resolved',
        outcome: parsedTransition.outcome,
        closingNote: parsedTransition.closingNote,
      }),
      reportStatus: 'resolved' as const,
      auditEvent: auditEventSchema.parse({
        id: `audit_${current.id}_resolve`,
        actor: parsedTransition.actor,
        action: 'review_task.resolved',
        targetType: 'review_task',
        targetId: current.id,
        outcome: 'succeeded',
        occurredAt: parsedTransition.occurredAt,
        metadata: {
          reviewOutcome: parsedTransition.outcome,
        },
      }),
    };
  }

  if (current.state !== 'resolved') {
    throw new Error('Only resolved review tasks can be closed.');
  }

  return {
    reviewTask: reviewTaskSchema.parse({
      ...current,
      state: 'closed',
      closedAt: parsedTransition.occurredAt,
    }),
    reportStatus: 'closed' as const,
    auditEvent: auditEventSchema.parse({
      id: `audit_${current.id}_close`,
      actor: parsedTransition.actor,
      action: 'review_task.closed',
      targetType: 'review_task',
      targetId: current.id,
      outcome: 'succeeded',
      occurredAt: parsedTransition.occurredAt,
    }),
  };
}
