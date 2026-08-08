import { describe, expect, it } from 'vitest';
import { seedMarketplaceServices, seedServiceById } from '../../src/engines/marketplace/seed-catalog.js';

describe('marketplace seed catalog', () => {
  it('ships the K.4 fleet specialists plus weather fixtures', () => {
    const ids = seedMarketplaceServices().map((service) => service.id);
    expect(ids).toContain('svc_demo_data_fetcher');
    expect(ids).toContain('svc_demo_analyst');
    expect(ids).toContain('svc_demo_writer');
    expect(ids).toContain('svc_demo_senior_reviewer');
    expect(ids).toContain('svc_testnet_weather_base');
  });

  it('keeps SeniorReviewer on Base for the cross-chain hop', () => {
    const reviewer = seedServiceById('svc_demo_senior_reviewer');
    expect(reviewer?.chain).toBe('base');
    expect(reviewer?.rails).toEqual(['x402']);
  });

  it('exposes a known payTo for weather so Lane 1 authorize can run', () => {
    const weather = seedServiceById('svc_testnet_weather_base');
    expect(weather?.providerAddress).toMatch(/^0x/i);
    expect(weather?.rails).toEqual(['x402']);
  });
});
