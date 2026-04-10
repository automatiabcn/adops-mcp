import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Storage } from '../../src/services/storage.js';
import { seedDemoAdPortfolio } from '../../src/services/demo-seed.js';
import { generatePerformanceReport } from '../../src/services/analytics.js';

const TEST_DIR = path.join(process.cwd(), 'data-test-ad-demo');

describe('seedDemoAdPortfolio', () => {
  let store: Storage;

  beforeEach(() => { store = new Storage(TEST_DIR); });
  afterEach(async () => { try { await fs.rm(TEST_DIR, { recursive: true, force: true }); } catch {} });

  it('creates platform connections, campaigns, metrics, and alerts', async () => {
    const result = await seedDemoAdPortfolio(store);
    expect(result.connections).toBe(2);
    expect(result.campaigns).toBeGreaterThanOrEqual(8);
    expect(result.metrics_days).toBe(30);
    expect(result.metrics_rows).toBe(result.campaigns * 30);
    expect(result.alerts).toBeGreaterThanOrEqual(1);
  });

  it('seeds both Google and Meta connections', async () => {
    await seedDemoAdPortfolio(store);
    const connections = await store.getAllConnections();
    const platforms = new Set(connections.map((c) => c.platform));
    expect(platforms.has('google')).toBe(true);
    expect(platforms.has('meta')).toBe(true);
  });

  it('campaigns are linked to the correct platform connections', async () => {
    await seedDemoAdPortfolio(store);
    const connections = await store.getAllConnections();
    const campaigns = await store.getAllCampaigns();
    const connIds = new Set(connections.map((c) => c.id));
    for (const c of campaigns) {
      expect(connIds.has(c.connection_id)).toBe(true);
    }
  });

  it('metrics have the correct shape and are well-distributed across platforms', async () => {
    await seedDemoAdPortfolio(store);
    const metrics = await store.getAllMetrics();
    const googleCount = metrics.filter((m) => m.platform === 'google').length;
    const metaCount = metrics.filter((m) => m.platform === 'meta').length;
    expect(googleCount).toBeGreaterThan(0);
    expect(metaCount).toBeGreaterThan(0);

    for (const m of metrics.slice(0, 5)) {
      expect(m.impressions).toBeGreaterThanOrEqual(0);
      expect(m.clicks).toBeGreaterThanOrEqual(0);
      expect(m.spend).toBeGreaterThanOrEqual(0);
      expect(m.ctr).toBeGreaterThanOrEqual(0);
    }
  });

  it('generates anomaly alerts only for underperforming campaigns', async () => {
    await seedDemoAdPortfolio(store);
    const alerts = await store.getAllAlerts();
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    for (const a of alerts) {
      expect(a.severity).toBe('high');
      expect(a.deviation_percent).toBeLessThan(0); // under-performance
    }
  });

  it('seeded data drives a meaningful ads_report output', async () => {
    await seedDemoAdPortfolio(store);
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
    const report = await generatePerformanceReport(start, end, undefined, undefined, 'spend', 20, store);

    expect(report.summary.total_spend).toBeGreaterThan(0);
    expect(report.summary.total_impressions).toBeGreaterThan(0);
    expect(report.summary.total_clicks).toBeGreaterThan(0);
    expect(report.summary.blended_roas).toBeGreaterThan(0);
    expect(report.by_platform.length).toBeGreaterThanOrEqual(2); // google + meta
    expect(report.by_campaign.length).toBeGreaterThanOrEqual(8);
    expect(report.top_performers.length).toBeGreaterThanOrEqual(1);
    expect(report.underperformers.length).toBeGreaterThanOrEqual(1);
  });

  it('is safe to call multiple times (each call appends a new portfolio)', async () => {
    const first = await seedDemoAdPortfolio(store);
    const second = await seedDemoAdPortfolio(store);
    expect(first.campaigns).toBe(second.campaigns);
    const allCampaigns = await store.getAllCampaigns();
    expect(allCampaigns.length).toBe(first.campaigns + second.campaigns);
  });
});
