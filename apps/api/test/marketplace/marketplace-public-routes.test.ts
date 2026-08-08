import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

describe('public marketplace catalog', () => {
  let store: PostgresTestStore;
  let app: FastifyInstance;

  beforeAll(async () => {
    store = await startPostgres();
    app = buildApp({
      marketplace: { pool: store.pool },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await store.stop();
  });

  it('lists seed services without authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/marketplace/listings' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      readonly listings: ReadonlyArray<{
        readonly id: string;
        readonly kind: string;
        readonly destinationAuthorized?: boolean;
      }>;
    };
    expect(body.listings.some((listing) => listing.id === 'svc_demo_data_fetcher')).toBe(true);
    expect(body.listings.every((listing) => listing.destinationAuthorized === undefined)).toBe(true);
  });

  it('filters by kind=service', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/marketplace/listings?kind=service',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { readonly listings: ReadonlyArray<{ readonly kind: string }> };
    expect(body.listings.length).toBeGreaterThan(0);
    expect(body.listings.every((listing) => listing.kind === 'service')).toBe(true);
  });

  it('returns a seed listing detail and empty activity', async () => {
    const detail = await app.inject({
      method: 'GET',
      url: '/v1/marketplace/listings/svc_demo_data_fetcher',
    });
    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json() as { readonly listing: { readonly id: string; readonly name: string } };
    expect(detailBody.listing.id).toBe('svc_demo_data_fetcher');
    expect(detailBody.listing.name).toBe('DataFetcher');

    const activity = await app.inject({
      method: 'GET',
      url: '/v1/marketplace/listings/svc_demo_data_fetcher/activity',
    });
    expect(activity.statusCode).toBe(200);
    const activityBody = activity.json() as {
      readonly activity: {
        readonly reputationScore: number;
        readonly completedJobs: number;
        readonly series: readonly unknown[];
      };
    };
    expect(activityBody.activity.reputationScore).toBe(0);
    expect(activityBody.activity.completedJobs).toBe(0);
    expect(Array.isArray(activityBody.activity.series)).toBe(true);
  });

  it('404s unknown listings', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/marketplace/listings/svc_does_not_exist',
    });
    expect(response.statusCode).toBe(404);
  });
});
