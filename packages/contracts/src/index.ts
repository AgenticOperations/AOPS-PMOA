import { z } from 'zod';

export const sectionIdSchema = z.enum([
  'section_0',
  'section_11a',
  'section_1',
  'section_2',
  'section_3',
  'section_4',
  'section_5',
  'section_6',
  'section_7',
  'section_8',
  'section_12',
  'section_11',
  'section_9',
  'section_10',
]);

export type SectionId = z.infer<typeof sectionIdSchema>;

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.string(),
  version: z.string(),
  section: sectionIdSchema,
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const auditOutcomeSchema = z.enum([
  'requested',
  'allowed',
  'blocked',
  'queued_for_approval',
  'approved',
  'denied',
  'executed',
  'failed',
  'observed',
  'reconciled',
  'superseded',
]);

export type AuditOutcome = z.infer<typeof auditOutcomeSchema>;
