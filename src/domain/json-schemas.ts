import { zodToJsonSchema } from 'zod-to-json-schema';
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
