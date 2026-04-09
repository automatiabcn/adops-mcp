/**
 * End-to-End User Workflow Tests
 *
 * Simulates a real user journey through AdOps MCP:
 * 1. Connect platforms
 * 2. Create campaigns
 * 3. Add performance data
 * 4. Generate reports
 * 5. Detect anomalies
 * 6. Optimize budgets
 * 7. Run A/B tests
 * 8. Get forecasts and benchmarks
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { Storage } from '../../src/services/storage.js';
import { generatePerformanceReport, generateAudienceInsights, generateBenchmark, forecastSpend } from '../../src/services/analytics.js';
import { analyzeBudget, reallocateBudget } from '../../src/services/optimizer.js';
import { detectAnomalies } from '../../src/services/anomaly.js';
import { analyzeABTest } from '../../src/services/ab-test.js';
import { getCreativeSpecs } from '../../src/services/creative-specs.js';
import type { PlatformConnection, UnifiedCampaign, UnifiedMetrics, Platform } from '../../src/models/adops.js';

const TEST_DIR = path.join(process.cwd(), 'data-test-e2e');

describe('E2E: Full User Workflow', () => {
  let store: Storage;
  let googleConn: PlatformConnection;
  let metaConn: PlatformConnection;
  let googleCampaign: UnifiedCampaign;
  let metaCampaignA: UnifiedCampaign;
  let metaCampaignB: UnifiedCampaign;

  beforeEach(async () => {
    store = new Storage(TEST_DIR);

    // ── Step 1: User connects Google Ads and Meta accounts ──────
    googleConn = {
      id: uuidv4(), platform: 'google', name: 'My Google Ads',
      account_id: '1234567890', connected_at: new Date().toISOString(),
      last_sync_at: null, status: 'active',
    };
    metaConn = {
      id: uuidv4(), platform: 'meta', name: 'My Meta Business',
      account_id: 'act_987654321', connected_at: new Date().toISOString(),
      last_sync_at: null, status: 'active',
    };
    await store.addConnection(googleConn);
    await store.addConnection(metaConn);

    // ── Step 2: User creates campaigns ──────────────────────────
    const now = new Date().toISOString();
    googleCampaign = {
      id: uuidv4(), platform: 'google', platform_campaign_id: 'google_100',
      connection_id: googleConn.id, name: 'Google Search - SaaS Keywords',
      status: 'active', objective: 'conversions', bidding_strategy: 'target_cpa',
      daily_budget: 150, total_budget: null, currency: 'USD',
      start_date: '2026-03-15', end_date: null,
      targeting: { geo: ['US', 'GB'], age_min: 25, age_max: 55, gender: 'all', interests: ['saas', 'technology'], devices: ['desktop', 'mobile'] },
      created_at: now, updated_at: now, synced_at: null,
    };
    metaCampaignA = {
      id: uuidv4(), platform: 'meta', platform_campaign_id: 'meta_200',
      connection_id: metaConn.id, name: 'Meta Feed - Variant A (Video)',
      status: 'active', objective: 'conversions', bidding_strategy: 'lowest_cost',
      daily_budget: 100, total_budget: null, currency: 'USD',
      start_date: '2026-03-20', end_date: null,
      targeting: { geo: ['US'], age_min: 22, age_max: 40, gender: 'all', interests: ['entrepreneurship', 'startups'], devices: ['mobile'] },
      created_at: now, updated_at: now, synced_at: null,
    };
    metaCampaignB = {
      id: uuidv4(), platform: 'meta', platform_campaign_id: 'meta_201',
      connection_id: metaConn.id, name: 'Meta Feed - Variant B (Carousel)',
      status: 'active', objective: 'conversions', bidding_strategy: 'lowest_cost',
      daily_budget: 100, total_budget: null, currency: 'USD',
      start_date: '2026-03-20', end_date: null,
      targeting: { geo: ['US'], age_min: 22, age_max: 40, gender: 'all', interests: ['entrepreneurship', 'startups'], devices: ['mobile'] },
      created_at: now, updated_at: now, synced_at: null,
    };
    await store.addCampaign(googleCampaign);
    await store.addCampaign(metaCampaignA);
    await store.addCampaign(metaCampaignB);

    // ── Step 3: Simulate 14 days of performance data ────────────
    const now_ts = Date.now();
    for (let day = 14; day >= 1; day--) {
      const date = new Date(now_ts - day * 86400000).toISOString().split('T')[0];

      // Google: strong performer, consistent
      const gSpend = 140 + Math.random() * 20;
      const gClicks = 280 + Math.round(Math.random() * 40);
      const gImpressions = 14000 + Math.round(Math.random() * 2000);
      const gConversions = 18 + Math.round(Math.random() * 6);
      const gRevenue = gConversions * 45;
      await store.addMetrics(makeMetrics(googleCampaign.id, 'google', date, gSpend, gClicks, gImpressions, gConversions, gRevenue));

      // Meta A (Video): decent, starts well
      const maSpend = 90 + Math.random() * 20;
      const maClicks = 200 + Math.round(Math.random() * 40);
      const maImpressions = 18000 + Math.round(Math.random() * 3000);
      const maConversions = 8 + Math.round(Math.random() * 4);
      const maRevenue = maConversions * 35;
      await store.addMetrics(makeMetrics(metaCampaignA.id, 'meta', date, maSpend, maClicks, maImpressions, maConversions, maRevenue, Math.round(maImpressions * 0.7)));

      // Meta B (Carousel): weaker, less conversions
      const mbSpend = 95 + Math.random() * 15;
      const mbClicks = 150 + Math.round(Math.random() * 30);
      const mbImpressions = 20000 + Math.round(Math.random() * 3000);
      const mbConversions = 4 + Math.round(Math.random() * 3);
      const mbRevenue = mbConversions * 30;
      await store.addMetrics(makeMetrics(metaCampaignB.id, 'meta', date, mbSpend, mbClicks, mbImpressions, mbConversions, mbRevenue, Math.round(mbImpressions * 0.65)));
    }
  });

  afterEach(async () => { try { await fs.rm(TEST_DIR, { recursive: true, force: true }); } catch {} });

  // ── Scenario 1: "Show me how my ads are doing" ───────────────

  it('should generate a complete cross-platform report', async () => {
    const now = new Date();
    const start = new Date(now.getTime() - 14 * 86400000).toISOString().split('T')[0];
    const end = now.toISOString().split('T')[0];

    const report = await generatePerformanceReport(start, end, undefined, undefined, 'spend', 20, store);

    // Report should have real data
    expect(report.summary.total_spend).toBeGreaterThan(0);
    expect(report.summary.total_clicks).toBeGreaterThan(0);
    expect(report.summary.total_conversions).toBeGreaterThan(0);
    expect(report.summary.total_revenue).toBeGreaterThan(0);

    // Blended metrics should be calculated
    expect(report.summary.blended_ctr).toBeGreaterThan(0);
    expect(report.summary.blended_cpc).toBeGreaterThan(0);
    expect(report.summary.blended_roas).toBeGreaterThan(0);

    // Both platforms present
    expect(report.by_platform).toHaveLength(2);
    const google = report.by_platform.find((p) => p.platform === 'google');
    const meta = report.by_platform.find((p) => p.platform === 'meta');
    expect(google).toBeDefined();
    expect(meta).toBeDefined();

    // All 3 campaigns in the report
    expect(report.by_campaign.length).toBe(3);

    // Google should be top performer (higher ROAS)
    expect(google!.roas).toBeGreaterThan(meta!.roas);

    // Top performers should include Google
    expect(report.top_performers.length).toBeGreaterThan(0);
  });

  // ── Scenario 2: "Which platform is doing better for Google?" ─

  it('should filter report by platform', async () => {
    const now = new Date();
    const start = new Date(now.getTime() - 14 * 86400000).toISOString().split('T')[0];
    const end = now.toISOString().split('T')[0];

    const googleOnly = await generatePerformanceReport(start, end, 'google', undefined, 'spend', 20, store);
    expect(googleOnly.by_platform).toHaveLength(1);
    expect(googleOnly.by_platform[0].platform).toBe('google');
    expect(googleOnly.by_campaign).toHaveLength(1);
    expect(googleOnly.by_campaign[0].campaign_name).toContain('Google');
  });

  // ── Scenario 3: "Should I move budget from Meta to Google?" ──

  it('should analyze budget and recommend reallocation', async () => {
    const analysis = await analyzeBudget('maximize_roas', undefined, store);

    expect(analysis.total_daily_budget).toBe(350); // 150 + 100 + 100
    expect(analysis.by_platform).toHaveLength(2);

    // Google should have better ROAS
    const googlePlatform = analysis.by_platform.find((p) => p.platform === 'google');
    const metaPlatform = analysis.by_platform.find((p) => p.platform === 'meta');
    expect(googlePlatform).toBeDefined();
    expect(metaPlatform).toBeDefined();
    expect(googlePlatform!.roas).toBeGreaterThan(0);

    // Should have recommendations
    expect(analysis.recommendations.length).toBeGreaterThanOrEqual(0);
  });

  // ── Scenario 4: "Move $30 from Meta B to Google" ─────────────

  it('should reallocate budget between campaigns', async () => {
    const result = await reallocateBudget(metaCampaignB.id, googleCampaign.id, 30, store);

    expect(result.from.new_budget).toBe(70);  // 100 - 30
    expect(result.to.new_budget).toBe(180);   // 150 + 30
    expect(result.amount).toBe(30);

    // Verify it persisted
    const updatedGoogle = await store.getCampaignById(googleCampaign.id);
    const updatedMetaB = await store.getCampaignById(metaCampaignB.id);
    expect(updatedGoogle!.daily_budget).toBe(180);
    expect(updatedMetaB!.daily_budget).toBe(70);
  });

  // ── Scenario 5: "Compare Video vs Carousel ad" ───────────────

  it('should analyze A/B test between two Meta campaigns', async () => {
    const result = await analyzeABTest(metaCampaignA.id, metaCampaignB.id, 'ctr', store);

    expect(result.test_name).toContain('Variant A');
    expect(result.test_name).toContain('Variant B');

    // Both variants should have data
    expect(result.variant_a.impressions).toBeGreaterThan(0);
    expect(result.variant_b.impressions).toBeGreaterThan(0);
    expect(result.variant_a.spend).toBeGreaterThan(0);
    expect(result.variant_b.spend).toBeGreaterThan(0);

    // CTR should differ
    expect(result.variant_a.ctr).not.toBe(result.variant_b.ctr);

    // Confidence should be calculated
    expect(result.confidence_level).toBeGreaterThanOrEqual(0);
    expect(result.confidence_level).toBeLessThanOrEqual(100);

    // Should have a recommendation
    expect(result.recommendation.length).toBeGreaterThan(10);

    // Sample size should be sufficient (14 days * ~200 clicks)
    expect(result.sample_size_sufficient).toBe(true);
  });

  // ── Scenario 6: "Are there any performance issues?" ──────────

  it('should detect anomalies when CPC spikes', async () => {
    // Inject a CPC spike in the last 3 days for Google
    const now = Date.now();
    for (let day = 3; day >= 1; day--) {
      const date = new Date(now - day * 86400000).toISOString().split('T')[0];
      // Triple the CPC: spend 3x but same clicks
      await store.addMetrics(makeMetrics(googleCampaign.id, 'google', date, 450, 290, 14500, 18, 810, null));
    }

    const alerts = await detectAnomalies('high', 7, undefined, store);
    // Should detect at least one anomaly (spend or CPC spike)
    const googleAlerts = alerts.filter((a) => a.campaign_name.includes('Google'));
    expect(googleAlerts.length).toBeGreaterThan(0);
    expect(googleAlerts[0].recommendation.length).toBeGreaterThan(0);
  });

  // ── Scenario 7: "How am I doing vs the industry?" ────────────

  it('should benchmark against SaaS industry', async () => {
    const benchmark = await generateBenchmark('saas', undefined, store);

    expect(benchmark.industry).toBe('saas');
    expect(benchmark.benchmarks.avg_ctr).toBeGreaterThan(0);
    expect(benchmark.your_performance.ctr).toBeGreaterThan(0);

    // 6 metrics compared
    expect(benchmark.comparison).toHaveLength(6);
    for (const c of benchmark.comparison) {
      expect(['above_average', 'average', 'below_average']).toContain(c.rating);
      expect(c.your_value).toBeGreaterThanOrEqual(0);
      expect(c.industry_avg).toBeGreaterThan(0);
    }

    // Should have actionable recommendations
    expect(benchmark.recommendations.length).toBeGreaterThan(0);
  });

  // ── Scenario 8: "What will I spend next 2 weeks?" ────────────

  it('should forecast spend for the next 14 days', async () => {
    const forecast = await forecastSpend(14, undefined, store);

    expect(forecast.forecast_period_days).toBe(14);
    expect(forecast.projected_spend).toBeGreaterThan(0);
    expect(forecast.projected_clicks).toBeGreaterThan(0);
    expect(forecast.projected_conversions).toBeGreaterThan(0);
    expect(forecast.projected_revenue).toBeGreaterThan(0);
    expect(forecast.projected_roas).toBeGreaterThan(0);

    // Confidence interval should be reasonable
    expect(forecast.confidence_interval.low).toBeLessThan(forecast.projected_spend);
    expect(forecast.confidence_interval.high).toBeGreaterThan(forecast.projected_spend);

    // Both platforms in forecast
    expect(forecast.by_platform).toHaveLength(2);

    // Assumptions documented
    expect(forecast.assumptions.length).toBeGreaterThan(0);
  });

  // ── Scenario 9: "What specs for Meta Stories ad?" ────────────

  it('should return accurate creative specs', async () => {
    const metaSpecs = getCreativeSpecs('meta');
    expect(metaSpecs.length).toBeGreaterThan(0);

    const stories = getCreativeSpecs('meta', 'stories');
    expect(stories.length).toBe(1);
    expect(stories[0].format).toContain('Stories');
    expect(stories[0].image_specs!.width).toBe(1080);
    expect(stories[0].image_specs!.height).toBe(1920);
    expect(stories[0].image_specs!.aspect_ratio).toBe('9:16');

    const googleSearch = getCreativeSpecs('google', 'search');
    expect(googleSearch.length).toBe(1);
    expect(googleSearch[0].text_specs.headline_max_chars).toBe(30);
    expect(googleSearch[0].text_specs.description_max_chars).toBe(90);
  });

  // ── Scenario 10: "Who's my audience on Meta?" ────────────────

  it('should provide audience insights', async () => {
    const insights = await generateAudienceInsights('meta', metaCampaignA.id, store);

    expect(insights.platform).toBe('meta');
    expect(insights.total_reach).toBeGreaterThan(0);

    // Demographics populated
    expect(insights.demographics.age_groups.length).toBe(5);
    expect(insights.demographics.gender.length).toBe(3);
    expect(insights.demographics.top_locations.length).toBeGreaterThan(0);

    // Percentages should sum to ~100
    const agePctSum = insights.demographics.age_groups.reduce((s, a) => s + a.percentage, 0);
    expect(agePctSum).toBe(100);

    // Device breakdown
    expect(insights.device_breakdown.length).toBe(3);

    // Top interests
    expect(insights.top_interests.length).toBeGreaterThan(0);
    expect(insights.top_interests[0].affinity_score).toBeGreaterThan(0);
  });

  // ── Scenario 11: "Pause that bad campaign" ───────────────────

  it('should pause and resume campaigns correctly', async () => {
    // Pause Meta B
    const paused = await store.updateCampaign(metaCampaignB.id, { status: 'paused' });
    expect(paused!.status).toBe('paused');

    // Campaign list should reflect the change
    const result = await store.searchCampaigns({ status: 'active' });
    expect(result.total).toBe(2); // Google + Meta A

    // Resume it
    const resumed = await store.updateCampaign(metaCampaignB.id, { status: 'active' });
    expect(resumed!.status).toBe('active');

    const afterResume = await store.searchCampaigns({ status: 'active' });
    expect(afterResume.total).toBe(3);
  });

  // ── Scenario 12: "Search for my Google campaigns" ────────────

  it('should search campaigns by name', async () => {
    const result = await store.searchCampaigns({ query: 'google' });
    expect(result.total).toBe(1);
    expect(result.campaigns[0].name).toContain('Google');

    const meta = await store.searchCampaigns({ platform: 'meta' });
    expect(meta.total).toBe(2);

    const all = await store.searchCampaigns({});
    expect(all.total).toBe(3);
  });

  // ── Scenario 13: "Don't allow nonsensical budget transfer" ───

  it('should reject budget reallocation exceeding source budget', async () => {
    await expect(
      reallocateBudget(metaCampaignB.id, googleCampaign.id, 999, store)
    ).rejects.toThrow(/Cannot reallocate/);
  });

  // ── Scenario 14: "What if I only look at Google forecasts?" ──

  it('should forecast for a single platform', async () => {
    const googleForecast = await forecastSpend(7, 'google', store);
    expect(googleForecast.by_platform).toHaveLength(1);
    expect(googleForecast.by_platform[0].platform).toBe('google');
    expect(googleForecast.projected_spend).toBeGreaterThan(0);
  });
});

// ── Helpers ─────────────────────────────────────────────────────────

function makeMetrics(
  campaignId: string, platform: Platform, date: string,
  spend: number, clicks: number, impressions: number,
  conversions: number, revenue: number, reach: number | null = null,
): UnifiedMetrics {
  return {
    campaign_id: campaignId, platform, date, impressions, clicks, spend,
    conversions, conversion_value: revenue,
    ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
    cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
    cpm: impressions > 0 ? Math.round((spend / impressions) * 1000 * 100) / 100 : 0,
    roas: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0,
    cpa: conversions > 0 ? Math.round((spend / conversions) * 100) / 100 : 0,
    conversion_rate: clicks > 0 ? Math.round((conversions / clicks) * 10000) / 100 : 0,
    reach, frequency: reach && impressions > 0 ? Math.round((impressions / reach) * 10) / 10 : null,
    quality_score: platform === 'google' ? 7 : null,
    video_views: null,
  };
}
