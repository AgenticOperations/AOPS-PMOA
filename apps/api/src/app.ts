import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { healthResponseSchema } from '@agentops-pmoa/contracts';
import type { RegisterApprovalRoutesDeps } from './engines/approvals/routes.js';
import { registerApprovalRoutes } from './engines/approvals/routes.js';
import type { RegisterEvidenceRoutesDeps } from './engines/evidence/routes.js';
import { registerEvidenceRoutes } from './engines/evidence/routes.js';
import type { RegisterIdentityRoutesDeps } from './engines/identity/routes.js';
import { registerIdentityRoutes } from './engines/identity/routes.js';
import type { RegisterOperationRoutesDeps } from './engines/operations/routes.js';
import { registerOperationRoutes } from './engines/operations/routes.js';
import type { RegisterPaymentRoutesDeps } from './engines/payments/routes.js';
import { registerPaymentRoutes } from './engines/payments/routes.js';
import { registerTestnetX402VerifierRoutes } from './engines/payments/testnet-x402-verifier.js';
import type { RegisterPolicyRoutesDeps } from './engines/policy/routes.js';
import { registerPolicyRoutes } from './engines/policy/routes.js';
import type { RegisterRuntimeRoutesDeps } from './engines/runtime/routes.js';
import { registerRuntimeRoutes } from './engines/runtime/routes.js';

export type BuildAppOptions = {
  readonly evidence?: RegisterEvidenceRoutesDeps;
  readonly identity?: RegisterIdentityRoutesDeps;
  readonly operations?: RegisterOperationRoutesDeps;
  readonly payments?: RegisterPaymentRoutesDeps;
  readonly policy?: RegisterPolicyRoutesDeps;
  readonly approvals?: RegisterApprovalRoutesDeps;
  readonly runtime?: RegisterRuntimeRoutesDeps;
};

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL !== undefined ? process.env.LOG_LEVEL : 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
  });

  app.get('/healthz', () =>
    healthResponseSchema.parse({
      ok: true,
      service: 'agentops-pmoa-api',
      version: '0.0.0',
      section: 'section_9',
    }),
  );

  registerTestnetX402VerifierRoutes(app);

  if (options.identity !== undefined) {
    registerIdentityRoutes(app, { ...options.identity, policy: options.policy });
  }

  if (options.evidence !== undefined) {
    registerEvidenceRoutes(app, options.evidence);
  }

  if (options.policy !== undefined) {
    registerPolicyRoutes(app, {
      ...options.policy,
      installErrorHandler: options.identity === undefined && options.approvals === undefined,
    });
  }

  if (options.approvals !== undefined) {
    registerApprovalRoutes(app, {
      ...options.approvals,
      installErrorHandler: options.identity === undefined && options.policy === undefined,
    });
  }

  if (options.payments !== undefined) {
    registerPaymentRoutes(app, {
      ...options.payments,
      installErrorHandler:
        options.identity === undefined &&
        options.policy === undefined &&
        options.approvals === undefined &&
        options.runtime === undefined &&
        options.operations === undefined,
    });
  }

  if (options.runtime !== undefined) {
    registerRuntimeRoutes(app, {
      ...options.runtime,
      installErrorHandler:
        options.identity === undefined &&
        options.policy === undefined &&
        options.approvals === undefined &&
        options.payments === undefined &&
        options.operations === undefined,
    });
  }

  if (options.operations !== undefined) {
    registerOperationRoutes(app, {
      ...options.operations,
      installErrorHandler:
        options.identity === undefined &&
        options.policy === undefined &&
        options.approvals === undefined &&
        options.payments === undefined &&
        options.runtime === undefined,
    });
  }
  return app;
}
