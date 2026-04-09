import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { Storage } from '../../src/services/storage.js';
import { generatePerformanceReport, calculateCTR, calculateCPC, calculateROAS, calculateCPA, calculateCPM, generateBenchmark, forecastSpend } from '../../src/services/analytics.js';
import type { UnifiedCampaign, UnifiedMetrics, Platform } from '../../src/models/adops.js';

const TEST_DIR = path.join(process.cwd(), 'data-test-analytics');

function makeCampaign(platform: Platform, overrides: Partial<UnifiedCampaign> = {}): UnifiedCampaign {
  const now = new Date().toISOString();
  return {
    id: uuidv4(), platform, platform_campaign_id: `${platform}_123`, connection_id: uuidv4(),
    name: `Test Campaign ${platform}`, status: 'active', objective: 'conversions',
    bidding_strategy: 'maximize_conversions', daily_budget: 100, total_budget: null,
    currency: 'USD', start_date: '2026-04-01', end_date: null,
    targeting: { geo: ['US'], age_min: 25, age_max: 45, gender: 'all', interests: [], devices: ['mobile', 'desktop'] },
    created_at: now, updated_at: now, synced_at: null,
    ...overrides,
  };
}

function makeMetrics(campaignId: string, platform: Platform, date: string, overrides: Partial<UnifiedMetrics> = {}): UnifiedMetrics {
  return {
    campaign_id: campaignId, platform, date,
    impressions: 10000, clicks: 250, spend: 150, conversions: 15, conversion_value: 600,
    ctr: 2.5, cpc: 0.6, cpm: 15, roas: 4, cpa: 10, conversion_rate: 6,
    reach: null, frequency: null, quality_score: null, video_views: null,
    ...overrides,
  };
}

describe('Analytics Engine', () => {
  let store: Storage;

  beforeEach(() => { store = new Storage(TEST_DIR); });
  afterEach(async () => { try { await fs.rm(TEST_DIR, { recursive: true, force: true }); } catch {} });

  // ── Metric calculations ─────────────────────────────────────────

  it('should calculate CTR correctly', () => {
    expect(calculateCTR(250, 10000)).toBe(2.5);
    expect(calculateCTR(0, 10000)).toBe(0);
    expect(calculateCTR(100, 0)).toBe(0);
  });

  it('should calculate CPC correctly', () => {
    expect(calculateCPC(150, 250)).toBe(0.6);
    expect(calculateCPC(100, 0)).toBe(0);
  });

  it('should calculate ROAS correctly', () => {
    expect(calculateROAS(600, 150)).toBe(4);
    expect(calculateROAS(0, 150)).toBe(0);
    expect(calculateROAS(100, 0)).toBe(0);
  });

  it('should calculate CPA correctly', () => {
    expect(calculateCPA(150, 15)).toBe(10);
    expect(calculateCPA(100, 0)).toBe(0);
  });

  it('should calculate CPM correctly', () => {
    expect(calculateCPM(150, 10000)).toBe(15);
    expect(calculateCPM(100, 0)).toBe(0);
  });

  // ── Performance Report ──────────────────────────────────────────

  it('should generate empty report when no metrics exist', async () => {
    const report = await generatePerformanceReport('2026-04-01', '2026-04-07', undefined, undefined, 'spend', 20, store);
    expect(report.summary.total_spend).toBe(0);
    expect(report.summary.total_clicks).toBe(0);
    expect(report.by_platform).toHaveLength(0);
    expect(report.by_campaign).toHaveLength(0);
  });

  it('should aggregate metrics across platforms', async () => {
    const googleCamp = makeCampaign('google', { name: 'Google Search' });
    const metaCamp = makeCampaign('meta', { name: 'Meta Feed' });
    await store.addCampaign(googleCamp);
    await store.addCampaign(metaCamp);

    await store.addMetrics(makeMetrics(googleCamp.id, 'google', '2026-04-05', { spend: 200, clicks: 300, conversions: 20, conversion_value: 800 }));
    await store.addMetrics(makeMetrics(metaCamp.id, 'meta', '2026-04-05', { spend: 150, clicks: 200, conversions: 10, conversion_value: 400 }));

    const report = await generatePerformanceReport('2026-04-01', '2026-04-07', undefined, undefined, 'spend', 20, store);

    expect(report.summary.total_spend).toBe(350);
    expect(report.summary.total_clicks).toBe(500);
    expect(report.summary.total_conversions).toBe(30);
    expect(report.by_platform).toHaveLength(2);
    expect(report.by_campaign).toHaveLength(2);
  });

  it('should filter by platform', async () => {
    const googleCamp = makeCampaign('google');
    const metaCamp = makeCampaign('meta');
    await store.addCampaign(googleCamp);
    await store.addCampaign(metaCamp);

    await store.addMetrics(makeMetrics(googleCamp.id, 'google', '2026-04-05'));
    await store.addMetrics(makeMetrics(metaCamp.id, 'meta', '2026-04-05'));

    const report = await generatePerformanceReport('2026-04-01', '2026-04-07', 'google', undefined, 'spend', 20, store);
    expect(report.by_platform).toHaveLength(1);
    expect(report.by_platform[0].platform).toBe('google');
  });

  it('should identify top performers and underperformers', async () => {
    const goodCamp = makeCampaign('google', { name: 'High ROAS' });
    const badCamp = makeCampaign('meta', { name: 'Low ROAS' });
    await store.addCampaign(goodCamp);
    await store.addCampaign(badCamp);

    await store.addMetrics(makeMetrics(goodCamp.id, 'google', '2026-04-05', { spend: 100, conversion_value: 500 }));
    await store.addMetrics(makeMetrics(badCamp.id, 'meta', '2026-04-05', { spend: 200, conversion_value: 50 }));

    const report = await generatePerformanceReport('2026-04-01', '2026-04-07', undefined, undefined, 'spend', 20, store);
    expect(report.top_performers.length).toBeGreaterThan(0);
    expect(report.top_performers[0].campaign_name).toBe('High ROAS');
    expect(report.underperformers.length).toBeGreaterThan(0);
    expect(report.underperformers[0].campaign_name).toBe('Low ROAS');
  });

  // ── Benchmark ───────────────────────────────────────────────────

  it('should generate industry benchmark comparison', async () => {
    const camp = makeCampaign('google');
    await store.addCampaign(camp);
    await store.addMetrics(makeMetrics(camp.id, 'google', '2026-04-05'));

    const benchmark = await generateBenchmark('ecommerce', undefined, store);
    expect(benchmark.industry).toBe('ecommerce');
    expect(benchmark.comparison).toHaveLength(6);
    expect(benchmark.benchmarks.avg_ctr).toBeGreaterThan(0);
    expect(benchmark.your_performance.ctr).toBeGreaterThan(0);
  });

  // ── Forecast ────────────────────────────────────────────────────

  it('should return empty forecast when no data', async () => {
    const forecast = await forecastSpend(14, undefined, store);
    expect(forecast.projected_spend).toBe(0);
    expect(forecast.assumptions).toContain('No historical data available for forecasting.');
  });

  it('should project spend based on historical data', async () => {
    const camp = makeCampaign('google');
    await store.addCampaign(camp);

    // Add 7 days of data
    for (let i = 1; i <= 7; i++) {
      await store.addMetrics(makeMetrics(camp.id, 'google', `2026-04-0${i}`, { spend: 100, conversions: 10, conversion_value: 400 }));
    }

    const forecast = await forecastSpend(14, undefined, store);
    expect(forecast.projected_spend).toBeGreaterThan(0);
    expect(forecast.projected_conversions).toBeGreaterThan(0);
    expect(forecast.by_platform).toHaveLength(1);
    expect(forecast.by_platform[0].platform).toBe('google');
  });
});
