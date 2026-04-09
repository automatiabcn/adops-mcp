import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { Storage } from '../../src/services/storage.js';
import { analyzeABTest } from '../../src/services/ab-test.js';
import type { UnifiedCampaign, UnifiedMetrics, Platform } from '../../src/models/adops.js';

const TEST_DIR = path.join(process.cwd(), 'data-test-abtest');

function makeCampaign(name: string, platform: Platform = 'meta'): UnifiedCampaign {
  const now = new Date().toISOString();
  return {
    id: uuidv4(), platform, platform_campaign_id: `${platform}_${Date.now()}`, connection_id: uuidv4(),
    name, status: 'active', objective: 'conversions', bidding_strategy: null,
    daily_budget: 100, total_budget: null, currency: 'USD', start_date: '2026-04-01', end_date: null,
    targeting: { geo: ['US'], age_min: null, age_max: null, gender: null, interests: [], devices: [] },
    created_at: now, updated_at: now, synced_at: null,
  };
}

function makeMetrics(campaignId: string, platform: Platform, clicks: number, impressions: number, conversions: number, spend: number, revenue: number): UnifiedMetrics {
  return {
    campaign_id: campaignId, platform, date: '2026-04-05',
    impressions, clicks, spend, conversions, conversion_value: revenue,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    roas: spend > 0 ? revenue / spend : 0,
    cpa: conversions > 0 ? spend / conversions : 0,
    conversion_rate: clicks > 0 ? (conversions / clicks) * 100 : 0,
    reach: null, frequency: null, quality_score: null, video_views: null,
  };
}

describe('A/B Test Analysis', () => {
  let store: Storage;

  beforeEach(() => { store = new Storage(TEST_DIR); });
  afterEach(async () => { try { await fs.rm(TEST_DIR, { recursive: true, force: true }); } catch {} });

  it('should compare two campaigns by CTR', async () => {
    const campA = makeCampaign('Variant A - Video');
    const campB = makeCampaign('Variant B - Carousel');
    await store.addCampaign(campA);
    await store.addCampaign(campB);

    // A: better CTR (3% vs 1.5%)
    await store.addMetrics(makeMetrics(campA.id, 'meta', 300, 10000, 20, 150, 800));
    await store.addMetrics(makeMetrics(campB.id, 'meta', 150, 10000, 10, 150, 400));

    const result = await analyzeABTest(campA.id, campB.id, 'ctr', store);
    expect(result.test_name).toContain('Variant A');
    expect(result.variant_a.ctr).toBeGreaterThan(result.variant_b.ctr);
    expect(result.primary_metric).toBe('ctr');
    expect(result.confidence_level).toBeGreaterThanOrEqual(0);
    expect(result.recommendation.length).toBeGreaterThan(0);
  });

  it('should determine no winner with insufficient data', async () => {
    const campA = makeCampaign('Small A');
    const campB = makeCampaign('Small B');
    await store.addCampaign(campA);
    await store.addCampaign(campB);

    // Very few clicks — not enough for significance
    await store.addMetrics(makeMetrics(campA.id, 'meta', 10, 500, 1, 20, 40));
    await store.addMetrics(makeMetrics(campB.id, 'meta', 8, 500, 1, 20, 35));

    const result = await analyzeABTest(campA.id, campB.id, 'ctr', store);
    expect(result.sample_size_sufficient).toBe(false);
    expect(result.recommendation).toContain('Insufficient');
  });

  it('should compare by CPA metric', async () => {
    const campA = makeCampaign('CPA Test A');
    const campB = makeCampaign('CPA Test B');
    await store.addCampaign(campA);
    await store.addCampaign(campB);

    await store.addMetrics(makeMetrics(campA.id, 'meta', 200, 10000, 20, 200, 800));
    await store.addMetrics(makeMetrics(campB.id, 'meta', 200, 10000, 10, 200, 400));

    const result = await analyzeABTest(campA.id, campB.id, 'cpa', store);
    expect(result.variant_a.cpa).toBeLessThan(result.variant_b.cpa);
  });

  it('should throw for non-existent campaign', async () => {
    const camp = makeCampaign('Only One');
    await store.addCampaign(camp);
    await expect(analyzeABTest(camp.id, uuidv4(), 'ctr', store)).rejects.toThrow();
  });
});
