import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { IdentityError } from '../identity/errors.js';
import { getMarketplaceListingActivity } from './activity.js';
import { getMarketplaceListing, listMarketplaceListings } from './store.js';

export type RegisterMarketplacePublicRoutesDeps = {
  readonly pool: pg.Pool;
  readonly installErrorHandler?: boolean | undefined;
};

const PUBLIC_MODE = 'test' as const;

const chainSchema = z.enum(['arc', 'base', 'arbitrum', 'polygon', 'optimism', 'avalanche']);

const listingsQuerySchema = z.object({
  chain: chainSchema.optional(),
  kind: z.enum(['all', 'agent', 'service']).default('all'),
});

const activityQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

/**
 * Public catalog — changelog-style, no session.
 * Spend paths stay on /v1/orgs/:orgId/marketplace/* (operator-gated).
 */
export function registerMarketplacePublicRoutes(
  app: FastifyInstance,
  deps: RegisterMarketplacePublicRoutesDeps,
): void {
  if (deps.installErrorHandler === true) {
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof IdentityError) {
        return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      }
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          error: 'validation_error',
          message: 'Request query is invalid.',
          issues: error.issues,
        });
      }
      throw error;
    });
  }

  app.get('/v1/marketplace/listings', async (request) => {
    const query = listingsQuerySchema.parse(request.query ?? {});
    const listings = await listMarketplaceListings(deps.pool, {
      mode: PUBLIC_MODE,
      ...(query.chain === undefined ? {} : { chain: query.chain }),
    });
    const filtered = query.kind === 'all'
      ? listings
      : listings.filter((listing) => listing.kind === query.kind);
    // Strip buyer-only fields from the public payload.
    return {
      listings: filtered.map(({ destinationAuthorized: _auth, ...listing }) => listing),
    };
  });

  app.get('/v1/marketplace/listings/:listingId', async (request) => {
    const params = request.params as { readonly listingId: string };
    const listing = await getMarketplaceListing(deps.pool, params.listingId, {
      mode: PUBLIC_MODE,
    });
    return { listing };
  });

  app.get('/v1/marketplace/listings/:listingId/activity', async (request) => {
    const params = request.params as { readonly listingId: string };
    const query = activityQuerySchema.parse(request.query ?? {});
    const listing = await getMarketplaceListing(deps.pool, params.listingId, {
      mode: PUBLIC_MODE,
    });
    const activity = await getMarketplaceListingActivity(deps.pool, listing, {
      days: query.days,
    });
    return { activity };
  });
}
