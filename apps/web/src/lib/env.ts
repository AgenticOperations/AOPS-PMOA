import { z } from 'zod';

const webEnvSchema = z.object({
  AGENTOPS_API_BASE_URL: z.string().url().default('http://127.0.0.1:4010'),
  ARC_ENV_LABEL: z.string().default('local'),
  APP_BASE_URL: z.string().url().default('http://localhost:3005'),
  SESSION_COOKIE_NAME: z.string().min(1).default('agentops_session'),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export function readWebEnv(input: NodeJS.ProcessEnv = process.env): WebEnv {
  return webEnvSchema.parse(input);
}
