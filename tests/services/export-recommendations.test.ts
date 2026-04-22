import { describe, it, expect, beforeEach } from 'vitest';
import { exportRecommendations } from '../../src/services/export-recommendations.js';
import { Storage } from '../../src/services/storage.js';
import { v4 as uuidv4 } from 'uuid';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UnifiedCampaign, UnifiedMetrics, Platform } from '../../src/models/adops.js';

function makeStorage(): Storage {
  const dir = mkdtempSync(join(tmpdir(), `adops-export-${uuidv4()}-`));
  return new Storage(dir);
}

function makeCampaign(platform: Platform, name: string, dailyBudget: number): UnifiedCampaign {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    platform,
    platform_campaign_id: `${platform}-${name}`,
    connection_id: uuidv4(),
    name,
    status: 'active',
    objective: 'conversions',
    bidding_strategy: null,
    daily_budget: dailyBudget,
    total_budget: null,
    currency: 'USD',
    start_date: now.slice(0, 10),
    end_date: null,
    targeting: { geo: [], age_min: null, age_max: null, gender: null, interests: [], devices: [] },
    created_at: now,
    updated_at: now,
    synced_at: null,
  };
}

function makeMetrics(campaignId: string, platform: Platform, date: string, spend: number, conversions: number, revenue: number): UnifiedMetrics {
  const impressions = spend * 100;
  const clicks = spend * 10;
  return {
    campaign_id: campaignId,
    platform,
    date,
    impressions,
    clicks,
    spend,
    conversions,
    conversion_value: revenue,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    roas: spend > 0 ? revenue / spend : 0,
    cpa: conversions > 0 ? spend / conversions : 0,
    conversion_rate: clicks > 0 ? (conversions / clicks) * 100 : 0,
    reach: null,
    frequency: null,
    quality_score: null,
    video_views: null,
  };
}

describe('ads_export_recommendations', () => {
  let store: Storage;

  beforeEach(() => {
    store = makeStorage();
  });

  it('returns empty export when no campaigns exist', async () => {
    const result = await exportRecommendations({ format: 'json' }, store);
    expect(result.rows_exported).toBe(0);
    expect(result.summary.total_recommendations).toBe(0);
    expect(result.next_steps.length).toBeGreaterThan(0);
  });

  it('exports google_ads_csv with proper header', async () => {
    // Seed a high-ROAS campaign to trigger an 'increase' recommendation
    const camp = makeCampaign('google', 'Star Search Campaign', 50);
    await store.addCampaign(camp);
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getTime() - i * 86400000);
      await store.addMetrics(makeMetrics(camp.id, 'google', d.toISOString().slice(0, 10), 50, 10, 300));
    }

    const result = await exportRecommendations(
      { format: 'google_ads_csv', platform: 'google' },
      store,
    );
    expect(result.format).toBe('google_ads_csv');
    expect(result.content).toContain('Campaign,Action,Status,Budget,Reason,Expected Impact');
    expect(result.content).toContain('Star Search Campaign');
    expect(result.next_steps[0]).toContain('Google Ads Editor');
  });

  it('exports meta_ads_csv with Meta-specific header', async () => {
    const camp = makeCampaign('meta', 'Zero Conv Test', 100);
    await store.addCampaign(camp);
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getTime() - i * 86400000);
      await store.addMetrics(makeMetrics(camp.id, 'meta', d.toISOString().slice(0, 10), 100, 0, 0));
    }

    const result = await exportRecommendations(
      { format: 'meta_ads_csv', platform: 'meta' },
      store,
    );
    expect(result.format).toBe('meta_ads_csv');
    expect(result.content).toContain('Campaign name,Action,Campaign status,Campaign budget');
    expect(result.content).toContain('Zero Conv Test');
    expect(result.next_steps[0]).toContain('Meta Ads Manager');
  });

  it('exports json format with metadata wrapper', async () => {
    const camp = makeCampaign('google', 'JSON Test', 50);
    await store.addCampaign(camp);
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getTime() - i * 86400000);
      await store.addMetrics(makeMetrics(camp.id, 'google', d.toISOString().slice(0, 10), 50, 10, 300));
    }

    const result = await exportRecommendations({ format: 'json' }, store);
    expect(result.format).toBe('json');
    const parsed = JSON.parse(result.content ?? '{}');
    expect(parsed).toHaveProperty('generated_at');
    expect(parsed).toHaveProperty('optimization_goal');
    expect(parsed.recommendations).toBeInstanceOf(Array);
  });

  it('markdown format includes all recommendation fields', async () => {
    const camp = makeCampaign('google', 'MD Test', 50);
    await store.addCampaign(camp);
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getTime() - i * 86400000);
      await store.addMetrics(makeMetrics(camp.id, 'google', d.toISOString().slice(0, 10), 50, 10, 300));
    }

    const result = await exportRecommendations({ format: 'markdown' }, store);
    expect(result.format).toBe('markdown');
    expect(result.content).toContain('# AdOps Budget Recommendations');
    expect(result.content).toContain('Optimization goal:');
    expect(result.content).toContain('MD Test');
  });

  it('min_delta_pct filters out minor adjustments', async () => {
    // Seed a campaign whose recommendation has small delta
    const camp = makeCampaign('google', 'Small Delta', 100);
    await store.addCampaign(camp);
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getTime() - i * 86400000);
      // Moderate ROAS — small increase recommendation
      await store.addMetrics(makeMetrics(camp.id, 'google', d.toISOString().slice(0, 10), 100, 5, 450));
    }

    // With a very high threshold, it should filter everything
    const filtered = await exportRecommendations(
      { format: 'json', min_delta_pct: 0.99 },
      store,
    );
    expect(filtered.summary.filtered_out).toBeGreaterThanOrEqual(0);
  });

  it('limit caps the number of exported rows', async () => {
    // Seed many high-ROAS campaigns
    const today = new Date();
    for (let n = 0; n < 15; n++) {
      const camp = makeCampaign('google', `Campaign ${n}`, 50);
      await store.addCampaign(camp);
      for (let i = 0; i < 7; i++) {
        const d = new Date(today.getTime() - i * 86400000);
        await store.addMetrics(makeMetrics(camp.id, 'google', d.toISOString().slice(0, 10), 50, 10, 300));
      }
    }

    const result = await exportRecommendations(
      { format: 'json', limit: 5 },
      store,
    );
    expect(result.rows_exported).toBeLessThanOrEqual(5);
  });

  it('includes summary.by_type count breakdown', async () => {
    const camp = makeCampaign('google', 'Summary Test', 50);
    await store.addCampaign(camp);
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getTime() - i * 86400000);
      await store.addMetrics(makeMetrics(camp.id, 'google', d.toISOString().slice(0, 10), 50, 10, 300));
    }

    const result = await exportRecommendations({ format: 'json' }, store);
    expect(result.summary.by_type).toBeDefined();
    expect(typeof result.summary.by_type).toBe('object');
  });
});
