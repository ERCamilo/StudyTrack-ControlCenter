import { zodToJsonSchema } from 'zod-to-json-schema';
import { createIngestionRequestInputSchema, n8nCandidateWebhookSchema } from './n8n-intake.js';
import {
  auditEventSchema,
  careerVersionSchema,
  curriculumReportSchema,
  extractedCandidateSchema,
  ingestionRequestSchema,
  publicationJobSchema,
} from './schemas.js';

export const jsonSchemas = {
  CurriculumReport: zodToJsonSchema(curriculumReportSchema, {
    name: 'CurriculumReport',
    $refStrategy: 'none',
  }),
  IngestionRequest: zodToJsonSchema(ingestionRequestSchema, {
    name: 'IngestionRequest',
    $refStrategy: 'none',
  }),
  CreateIngestionRequestInput: zodToJsonSchema(createIngestionRequestInputSchema, {
    name: 'CreateIngestionRequestInput',
    $refStrategy: 'none',
  }),
  N8nCandidateWebhook: zodToJsonSchema(n8nCandidateWebhookSchema, {
    name: 'N8nCandidateWebhook',
    $refStrategy: 'none',
  }),
  ExtractedCandidate: zodToJsonSchema(extractedCandidateSchema, {
    name: 'ExtractedCandidate',
    $refStrategy: 'none',
  }),
  CareerVersion: zodToJsonSchema(careerVersionSchema, {
    name: 'CareerVersion',
    $refStrategy: 'none',
  }),
  PublicationJob: zodToJsonSchema(publicationJobSchema, {
    name: 'PublicationJob',
    $refStrategy: 'none',
  }),
  AuditEvent: zodToJsonSchema(auditEventSchema, {
    name: 'AuditEvent',
    $refStrategy: 'none',
  }),
} as const;

export type JsonSchemaName = keyof typeof jsonSchemas;
