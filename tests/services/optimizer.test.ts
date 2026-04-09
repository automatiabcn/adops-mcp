import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { Storage } from '../../src/services/storage.js';
import { analyzeBudget, reallocateBudget } from '../../src/services/optimizer.js';
import type { UnifiedCampaign, UnifiedMetrics, Platform } from '../../src/models/adops.js';

const TEST_DIR = path.join(process.cwd(), 'data-test-optimizer');

function makeCampaign(platform: Platform, name: string, budget: number, overrides: Partial<UnifiedCampaign> = {}): UnifiedCampaign {
  const now = new Date().toISOString();
  return {
    id: uuidv4(), platform, platform_campaign_id: `${platform}_${Date.now()}`, connection_id: uuidv4(),
    name, status: 'active', objective: 'conversions', bidding_strategy: 'maximize_conversions',
    daily_budget: budget, total_budget: null, currency: 'USD', start_date: '2026-04-01', end_date: null,
    targeting: { geo: ['US'], age_min: null, age_max: null, gender: null, interests: [], devices: [] },
    created_at: now, updated_at: now, synced_at: null,
    ...overrides,
  };
}

function makeMetrics(campaignId: string, platform: Platform, date: string, spend: number, conversions: number, revenue: number): UnifiedMetrics {
  const impressions = Math.round(spend * 100);
  const clicks = Math.round(spend * 2);
  return {
    campaign_id: campaignId, platform, date, impressions, clicks, spend, conversions, conversion_value: revenue,
    ctr: clicks / impressions * 100, cpc: spend / clicks, cpm: spend / impressions * 1000,
    roas: revenue / spend, cpa: conversions > 0 ? spend / conversions : 0,
    conversion_rate: conversions / clicks * 100,
    reach: null, frequency: null, quality_score: null, video_views: null,
  };
}

describe('Budget Optimizer', () => {
  let store: Storage;

  beforeEach(() => { store = new Storage(TEST_DIR); });
  afterEach(async () => { try { await fs.rm(TEST_DIR, { recursive: true, force: true }); } catch {} });

  it('should return empty analysis when no campaigns', async () => {
    const analysis = await analyzeBudget('maximize_roas', undefined, store);
    expect(analysis.total_daily_budget).toBe(0);
    expect(analysis.recommendations).toHaveLength(0);
  });

  it('should analyze budget across platforms', async () => {
    const google = makeCampaign('google', 'Google Search', 100);
    const meta = makeCampaign('meta', 'Meta Feed', 80);
    await store.addCampaign(google);
    await store.addCampaign(meta);

    const today = new Date().toISOString().split('T')[0];
    await store.addMetrics(makeMetrics(google.id, 'google', today, 90, 10, 400));
    await store.addMetrics(makeMetrics(meta.id, 'meta', today, 75, 5, 150));

    const analysis = await analyzeBudget('maximize_roas', undefined, store);
    expect(analysis.total_daily_budget).toBe(180);
    expect(analysis.by_platform).toHaveLength(2);
  });

  it('should recommend scaling high ROAS campaigns', async () => {
    const camp = makeCampaign('google', 'Star Campaign', 50);
    await store.addCampaign(camp);

    // 7 days of high ROAS data
    for (let i = 1; i <= 7; i++) {
      await store.addMetrics(makeMetrics(camp.id, 'google', `2026-04-0${i}`, 50, 10, 300));
    }

    const analysis = await analyzeBudget('maximize_roas', undefined, store);
    const increaseRec = analysis.recommendations.find((r) => r.type === 'increase');
    expect(increaseRec).toBeDefined();
    expect(increaseRec!.suggested_budget).toBeGreaterThan(50);
  });

  it('should recommend pausing zero-conversion campaigns', async () => {
    const camp = makeCampaign('meta', 'No Conversions', 100);
    await store.addCampaign(camp);

    for (let i = 1; i <= 7; i++) {
      await store.addMetrics(makeMetrics(camp.id, 'meta', `2026-04-0${i}`, 100, 0, 0));
    }

    const analysis = await analyzeBudget('maximize_roas', undefined, store);
    const pauseRec = analysis.recommendations.find((r) => r.type === 'pause');
    expect(pauseRec).toBeDefined();
    expect(pauseRec!.campaign_name).toBe('No Conversions');
  });

  it('should reallocate budget between campaigns', async () => {
    const from = makeCampaign('meta', 'Low Performer', 100);
    const to = makeCampaign('google', 'High Performer', 50);
    await store.addCampaign(from);
    await store.addCampaign(to);

    const result = await reallocateBudget(from.id, to.id, 30, store);
    expect(result.from.new_budget).toBe(70);
    expect(result.to.new_budget).toBe(80);
    expect(result.amount).toBe(30);

    // Verify persistence
    const updatedFrom = await store.getCampaignById(from.id);
    expect(updatedFrom!.daily_budget).toBe(70);
  });
});
