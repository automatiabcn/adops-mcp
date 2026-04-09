import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { Storage } from '../../src/services/storage.js';
import { detectAnomalies } from '../../src/services/anomaly.js';
import type { UnifiedCampaign, UnifiedMetrics, Platform } from '../../src/models/adops.js';

const TEST_DIR = path.join(process.cwd(), 'data-test-anomaly');

function makeCampaign(platform: Platform, name: string): UnifiedCampaign {
  const now = new Date().toISOString();
  return {
    id: uuidv4(), platform, platform_campaign_id: `${platform}_${Date.now()}`, connection_id: uuidv4(),
    name, status: 'active', objective: 'conversions', bidding_strategy: null,
    daily_budget: 100, total_budget: null, currency: 'USD', start_date: '2026-03-01', end_date: null,
    targeting: { geo: [], age_min: null, age_max: null, gender: null, interests: [], devices: [] },
    created_at: now, updated_at: now, synced_at: null,
  };
}

function makeMetrics(campaignId: string, platform: Platform, date: string, spend: number, clicks: number, impressions: number, conversions: number): UnifiedMetrics {
  return {
    campaign_id: campaignId, platform, date, impressions, clicks, spend, conversions, conversion_value: conversions * 40,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    roas: spend > 0 ? (conversions * 40) / spend : 0,
    cpa: conversions > 0 ? spend / conversions : 0,
    conversion_rate: clicks > 0 ? (conversions / clicks) * 100 : 0,
    reach: null, frequency: null, quality_score: null, video_views: null,
  };
}

describe('Anomaly Detection', () => {
  let store: Storage;

  beforeEach(() => { store = new Storage(TEST_DIR); });
  afterEach(async () => { try { await fs.rm(TEST_DIR, { recursive: true, force: true }); } catch {} });

  it('should return no anomalies when no data', async () => {
    const alerts = await detectAnomalies('medium', 7, undefined, store);
    expect(alerts).toHaveLength(0);
  });

  it('should detect CPC spike', async () => {
    const camp = makeCampaign('google', 'CPC Spike Campaign');
    await store.addCampaign(camp);

    const now = new Date();
    // Baseline: 14-8 days ago, CPC ~$1
    for (let i = 14; i >= 8; i--) {
      const date = new Date(now.getTime() - i * 86400000).toISOString().split('T')[0];
      await store.addMetrics(makeMetrics(camp.id, 'google', date, 100, 100, 10000, 10));
    }
    // Recent: last 7 days, CPC ~$2 (doubled)
    for (let i = 7; i >= 1; i--) {
      const date = new Date(now.getTime() - i * 86400000).toISOString().split('T')[0];
      await store.addMetrics(makeMetrics(camp.id, 'google', date, 200, 100, 10000, 10));
    }

    const alerts = await detectAnomalies('medium', 7, undefined, store);
    const cpcAlert = alerts.find((a) => a.metric === 'cpc');
    expect(cpcAlert).toBeDefined();
    expect(['high', 'critical']).toContain(cpcAlert!.severity);
    expect(cpcAlert!.actual_value).toBeGreaterThan(cpcAlert!.expected_value);
  });

  it('should detect conversion drop', async () => {
    const camp = makeCampaign('meta', 'Conv Drop Campaign');
    await store.addCampaign(camp);

    const now = new Date();
    // Baseline: good conversions
    for (let i = 14; i >= 8; i--) {
      const date = new Date(now.getTime() - i * 86400000).toISOString().split('T')[0];
      await store.addMetrics(makeMetrics(camp.id, 'meta', date, 100, 200, 10000, 20));
    }
    // Recent: conversions dropped 60%
    for (let i = 7; i >= 1; i--) {
      const date = new Date(now.getTime() - i * 86400000).toISOString().split('T')[0];
      await store.addMetrics(makeMetrics(camp.id, 'meta', date, 100, 200, 10000, 8));
    }

    const alerts = await detectAnomalies('medium', 7, undefined, store);
    const convAlert = alerts.find((a) => a.metric === 'conversions');
    expect(convAlert).toBeDefined();
    expect(convAlert!.actual_value).toBeLessThan(convAlert!.expected_value);
  });

  it('should respect sensitivity levels', async () => {
    const camp = makeCampaign('google', 'Subtle Change');
    await store.addCampaign(camp);

    const now = new Date();
    for (let i = 14; i >= 8; i--) {
      const date = new Date(now.getTime() - i * 86400000).toISOString().split('T')[0];
      await store.addMetrics(makeMetrics(camp.id, 'google', date, 100, 100, 10000, 10));
    }
    // 20% increase — should trigger high sensitivity but not low
    for (let i = 7; i >= 1; i--) {
      const date = new Date(now.getTime() - i * 86400000).toISOString().split('T')[0];
      await store.addMetrics(makeMetrics(camp.id, 'google', date, 120, 100, 10000, 10));
    }

    const highAlerts = await detectAnomalies('high', 7, undefined, store);
    const lowAlerts = await detectAnomalies('low', 7, undefined, store);
    expect(highAlerts.length).toBeGreaterThanOrEqual(lowAlerts.length);
  });

  it('should sort alerts by severity', async () => {
    const camp = makeCampaign('google', 'Multi Anomaly');
    await store.addCampaign(camp);

    const now = new Date();
    for (let i = 14; i >= 8; i--) {
      const date = new Date(now.getTime() - i * 86400000).toISOString().split('T')[0];
      await store.addMetrics(makeMetrics(camp.id, 'google', date, 100, 200, 10000, 20));
    }
    // Multiple anomalies: CPC spike + conversion drop
    for (let i = 7; i >= 1; i--) {
      const date = new Date(now.getTime() - i * 86400000).toISOString().split('T')[0];
      await store.addMetrics(makeMetrics(camp.id, 'google', date, 300, 100, 10000, 5));
    }

    const alerts = await detectAnomalies('medium', 7, undefined, store);
    expect(alerts.length).toBeGreaterThan(1);

    // Verify sorted by severity (critical first)
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    for (let i = 1; i < alerts.length; i++) {
      expect(severityOrder[alerts[i].severity]).toBeGreaterThanOrEqual(severityOrder[alerts[i - 1].severity]);
    }
  });
});
