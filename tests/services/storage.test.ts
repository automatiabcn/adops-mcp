import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { Storage } from '../../src/services/storage.js';
import type { PlatformConnection, UnifiedCampaign } from '../../src/models/adops.js';

const TEST_DIR = path.join(process.cwd(), 'data-test-storage');

describe('AdOps Storage', () => {
  let store: Storage;

  beforeEach(() => { store = new Storage(TEST_DIR); });
  afterEach(async () => { try { await fs.rm(TEST_DIR, { recursive: true, force: true }); } catch {} });

  it('should add and retrieve a connection', async () => {
    const conn: PlatformConnection = {
      id: uuidv4(), platform: 'google', name: 'Test Google',
      account_id: '1234567890', connected_at: new Date().toISOString(),
      last_sync_at: null, status: 'active',
    };
    await store.addConnection(conn);
    const found = await store.getConnectionById(conn.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Test Google');
  });

  it('should filter connections by platform', async () => {
    await store.addConnection({ id: uuidv4(), platform: 'google', name: 'G1', account_id: '111', connected_at: new Date().toISOString(), last_sync_at: null, status: 'active' });
    await store.addConnection({ id: uuidv4(), platform: 'meta', name: 'M1', account_id: '222', connected_at: new Date().toISOString(), last_sync_at: null, status: 'active' });

    const google = await store.getConnectionsByPlatform('google');
    expect(google).toHaveLength(1);
    expect(google[0].platform).toBe('google');
  });

  it('should add and search campaigns', async () => {
    const now = new Date().toISOString();
    const camp: UnifiedCampaign = {
      id: uuidv4(), platform: 'meta', platform_campaign_id: 'meta_1', connection_id: uuidv4(),
      name: 'Summer Sale', status: 'active', objective: 'conversions', bidding_strategy: null,
      daily_budget: 50, total_budget: null, currency: 'USD', start_date: '2026-04-01', end_date: null,
      targeting: { geo: ['US'], age_min: 18, age_max: 65, gender: 'all', interests: ['fashion'], devices: ['mobile'] },
      created_at: now, updated_at: now, synced_at: null,
    };
    await store.addCampaign(camp);

    const result = await store.searchCampaigns({ query: 'summer' });
    expect(result.total).toBe(1);
    expect(result.campaigns[0].name).toBe('Summer Sale');
  });

  it('should update campaign', async () => {
    const now = new Date().toISOString();
    const camp: UnifiedCampaign = {
      id: uuidv4(), platform: 'google', platform_campaign_id: 'g_1', connection_id: uuidv4(),
      name: 'Original', status: 'draft', objective: 'traffic', bidding_strategy: null,
      daily_budget: 25, total_budget: null, currency: 'EUR', start_date: '2026-04-01', end_date: null,
      targeting: { geo: [], age_min: null, age_max: null, gender: null, interests: [], devices: [] },
      created_at: now, updated_at: now, synced_at: null,
    };
    await store.addCampaign(camp);

    const updated = await store.updateCampaign(camp.id, { status: 'active', daily_budget: 75 });
    expect(updated!.status).toBe('active');
    expect(updated!.daily_budget).toBe(75);
    expect(updated!.name).toBe('Original');
  });

  it('should add and retrieve metrics by date range', async () => {
    const campId = uuidv4();
    await store.addMetrics({
      campaign_id: campId, platform: 'google', date: '2026-04-05',
      impressions: 1000, clicks: 50, spend: 30, conversions: 5, conversion_value: 200,
      ctr: 5, cpc: 0.6, cpm: 30, roas: 6.67, cpa: 6, conversion_rate: 10,
      reach: null, frequency: null, quality_score: null, video_views: null,
    });
    await store.addMetrics({
      campaign_id: campId, platform: 'google', date: '2026-04-10',
      impressions: 2000, clicks: 100, spend: 60, conversions: 8, conversion_value: 320,
      ctr: 5, cpc: 0.6, cpm: 30, roas: 5.33, cpa: 7.5, conversion_rate: 8,
      reach: null, frequency: null, quality_score: null, video_views: null,
    });

    const inRange = await store.getMetricsByDateRange('2026-04-04', '2026-04-06');
    expect(inRange).toHaveLength(1);

    const all = await store.getMetricsByDateRange('2026-04-01', '2026-04-15');
    expect(all).toHaveLength(2);
  });

  it('should handle batch metrics insert', async () => {
    const campId = uuidv4();
    const batch = Array.from({ length: 10 }, (_, i) => ({
      campaign_id: campId, platform: 'meta' as const, date: `2026-04-${String(i + 1).padStart(2, '0')}`,
      impressions: 1000, clicks: 50, spend: 25, conversions: 3, conversion_value: 120,
      ctr: 5, cpc: 0.5, cpm: 25, roas: 4.8, cpa: 8.33, conversion_rate: 6,
      reach: null, frequency: null, quality_score: null, video_views: null,
    }));
    const count = await store.addMetricsBatch(batch);
    expect(count).toBe(10);

    const all = await store.getAllMetrics();
    expect(all).toHaveLength(10);
  });
});
