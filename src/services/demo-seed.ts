import { v4 as uuidv4 } from 'uuid';
import { storage as defaultStorage, Storage } from './storage.js';
import type {
  PlatformConnection,
  UnifiedCampaign,
  UnifiedMetrics,
  AnomalyAlert,
  Platform,
} from '../models/adops.js';

/**
 * Seed a realistic cross-platform ad portfolio so users (and tests)
 * can explore AdOps without real Google Ads or Meta Ads credentials.
 *
 * The dataset is shaped for a D2C / e-commerce advertiser running in
 * parallel on Google and Meta:
 *   - 2 platform connections (one Google, one Meta)
 *   - 8 unified campaigns (4 per platform) covering different
 *     objectives and performance tiers so reports, benchmarks, and
 *     anomaly detection all have interesting data
 *   - 30 days of daily metrics per campaign, generated with
 *     deterministic "noise" on top of a performance baseline
 *   - a handful of pre-computed anomaly alerts on the worst
 *     performers so anomaly_detect has something to surface
 */

interface CampaignBlueprint {
  platform: Platform;
  name: string;
  status: 'active' | 'paused';
  objective: 'awareness' | 'reach' | 'traffic' | 'engagement' | 'leads' | 'conversions' | 'sales' | 'app_installs' | 'video_views' | 'other';
  daily_budget: number;
  // Baseline metrics per day — actual metrics will jitter around these
  baseline_impressions: number;
  baseline_ctr: number;        // as fraction, e.g. 0.021 for 2.1%
  baseline_cpc: number;
  baseline_conversion_rate: number; // as fraction
  baseline_aov: number;        // average order value
  tier: 'top' | 'mid' | 'under'; // Informs whether we flag an anomaly
}

const BLUEPRINTS: CampaignBlueprint[] = [
  // Google Ads
  { platform: 'google', name: 'Brand Defense — Search',      status: 'active', objective: 'conversions', daily_budget: 80,  baseline_impressions: 3200,  baseline_ctr: 0.064, baseline_cpc: 0.95, baseline_conversion_rate: 0.12, baseline_aov: 78,  tier: 'top' },
  { platform: 'google', name: 'Black Friday — Search',       status: 'active', objective: 'sales',       daily_budget: 260, baseline_impressions: 9800,  baseline_ctr: 0.042, baseline_cpc: 1.82, baseline_conversion_rate: 0.058, baseline_aov: 124, tier: 'top' },
  { platform: 'google', name: 'Category — Shopping Ads',     status: 'active', objective: 'sales',       daily_budget: 180, baseline_impressions: 12400, baseline_ctr: 0.031, baseline_cpc: 0.88, baseline_conversion_rate: 0.041, baseline_aov: 92,  tier: 'mid' },
  { platform: 'google', name: 'Prospecting — Display',       status: 'active', objective: 'traffic',     daily_budget: 220, baseline_impressions: 52000, baseline_ctr: 0.008, baseline_cpc: 0.42, baseline_conversion_rate: 0.006, baseline_aov: 64,  tier: 'under' },
  // Meta Ads
  { platform: 'meta',   name: 'Retargeting — Carousel',      status: 'active', objective: 'sales',       daily_budget: 190, baseline_impressions: 18000, baseline_ctr: 0.038, baseline_cpc: 0.92, baseline_conversion_rate: 0.072, baseline_aov: 88,  tier: 'top' },
  { platform: 'meta',   name: 'Lookalike — US 1%',           status: 'active', objective: 'conversions', daily_budget: 210, baseline_impressions: 24000, baseline_ctr: 0.019, baseline_cpc: 1.12, baseline_conversion_rate: 0.034, baseline_aov: 96,  tier: 'mid' },
  { platform: 'meta',   name: 'Reels — Spring Drop',         status: 'active', objective: 'awareness',   daily_budget: 170, baseline_impressions: 42000, baseline_ctr: 0.014, baseline_cpc: 0.58, baseline_conversion_rate: 0.012, baseline_aov: 74,  tier: 'under' },
  { platform: 'meta',   name: 'Stories — Creator Pack',      status: 'paused', objective: 'engagement',  daily_budget: 120, baseline_impressions: 31000, baseline_ctr: 0.022, baseline_cpc: 0.64, baseline_conversion_rate: 0.018, baseline_aov: 68,  tier: 'mid' },
];

/**
 * Deterministic-ish jitter using a seeded LCG so demo output is
 * reproducible across runs but looks noisy enough to be realistic.
 */
function jitter(seed: number, amplitude: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  const unit = (x - Math.floor(x)) * 2 - 1; // [-1, 1]
  return unit * amplitude;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface DemoSeedResult {
  connections: number;
  campaigns: number;
  metrics_days: number;
  metrics_rows: number;
  alerts: number;
  message: string;
}

/** Create a full AdOps demo dataset. Safe to call multiple times. */
export async function seedDemoAdPortfolio(store?: Storage): Promise<DemoSeedResult> {
  const s = store ?? defaultStorage;
  const now = new Date();

  // 1. Two platform connections
  const googleConn: PlatformConnection = {
    id: uuidv4(),
    platform: 'google',
    name: 'Acme D2C — Google Ads (demo)',
    account_id: '987-654-3210',
    connected_at: new Date(now.getTime() - 90 * 86_400_000).toISOString(),
    last_sync_at: now.toISOString(),
    status: 'active',
  };
  const metaConn: PlatformConnection = {
    id: uuidv4(),
    platform: 'meta',
    name: 'Acme D2C — Meta Business (demo)',
    account_id: 'act_501234567890',
    connected_at: new Date(now.getTime() - 90 * 86_400_000).toISOString(),
    last_sync_at: now.toISOString(),
    status: 'active',
  };
  await s.addConnection(googleConn);
  await s.addConnection(metaConn);

  // 2. Campaigns — one per blueprint
  const campaigns: UnifiedCampaign[] = BLUEPRINTS.map((bp, i) => {
    const connId = bp.platform === 'google' ? googleConn.id : metaConn.id;
    const startDate = new Date(now.getTime() - 60 * 86_400_000);
    return {
      id: uuidv4(),
      platform: bp.platform,
      platform_campaign_id: `${bp.platform}_${100000 + i}`,
      connection_id: connId,
      name: bp.name,
      status: bp.status,
      objective: bp.objective,
      bidding_strategy: bp.platform === 'google' ? 'target_roas' : 'lowest_cost',
      daily_budget: bp.daily_budget,
      total_budget: null,
      currency: 'USD',
      start_date: ymd(startDate),
      end_date: null,
      targeting: {
        geo: ['US', 'CA', 'GB'],
        age_min: 25,
        age_max: 54,
        gender: 'all',
        interests: bp.objective === 'sales' ? ['fashion', 'home_decor'] : ['tech', 'lifestyle'],
        devices: ['mobile', 'desktop'],
      },
      created_at: startDate.toISOString(),
      updated_at: now.toISOString(),
      synced_at: now.toISOString(),
    };
  });

  for (const c of campaigns) {
    await s.addCampaign(c);
  }

  // 3. 30 days of daily metrics per campaign
  const DAYS = 30;
  const metrics: UnifiedMetrics[] = [];

  for (const [i, bp] of BLUEPRINTS.entries()) {
    const campaign = campaigns[i];

    for (let d = 0; d < DAYS; d++) {
      const day = new Date(now.getTime() - (DAYS - 1 - d) * 86_400_000);
      const seed = i * 1000 + d;

      // Apply multiplicative jitter to each base metric
      const impJitter = 1 + jitter(seed + 1, 0.18);
      const ctrJitter = 1 + jitter(seed + 2, 0.12);
      const cpcJitter = 1 + jitter(seed + 3, 0.09);
      const convJitter = 1 + jitter(seed + 4, 0.20);

      const impressions = Math.max(0, Math.round(bp.baseline_impressions * impJitter));
      const ctr = Math.max(0, bp.baseline_ctr * ctrJitter);
      const clicks = Math.max(0, Math.round(impressions * ctr));
      const cpc = Math.max(0.05, bp.baseline_cpc * cpcJitter);
      const spend = Math.round(clicks * cpc * 100) / 100;
      const conversionRate = Math.max(0, bp.baseline_conversion_rate * convJitter);
      const conversions = Math.round(clicks * conversionRate * 10) / 10;
      const conversionValue = Math.round(conversions * bp.baseline_aov * 100) / 100;

      // Derived metrics (the existing services also compute these, but we
      // seed them pre-computed so ads_report doesn't have to recalculate).
      const cpm = impressions > 0 ? Math.round((spend / impressions) * 1000 * 100) / 100 : 0;
      const roas = spend > 0 ? Math.round((conversionValue / spend) * 100) / 100 : 0;
      const cpa = conversions > 0 ? Math.round((spend / conversions) * 100) / 100 : 0;

      metrics.push({
        campaign_id: campaign.id,
        platform: bp.platform,
        date: ymd(day),
        impressions,
        clicks,
        spend,
        conversions,
        conversion_value: conversionValue,
        ctr: Math.round(ctr * 10000) / 100,         // percent
        cpc: Math.round(cpc * 100) / 100,
        cpm,
        roas,
        cpa,
        conversion_rate: Math.round(conversionRate * 10000) / 100,
        reach: bp.platform === 'meta' ? Math.round(impressions * 0.72) : null,
        frequency: bp.platform === 'meta' ? Math.round((impressions / Math.max(1, impressions * 0.72)) * 100) / 100 : null,
        quality_score: bp.platform === 'google' ? Math.max(3, Math.round(8 + jitter(seed + 5, 1.5))) : null,
        video_views: bp.objective === 'awareness' ? Math.round(impressions * 0.35) : null,
      });
    }
  }

  await s.addMetricsBatch(metrics);

  // 4. A few pre-computed anomaly alerts on the underperformers
  const alerts: AnomalyAlert[] = BLUEPRINTS
    .map((bp, i) => ({ bp, campaign: campaigns[i] }))
    .filter(({ bp }) => bp.tier === 'under')
    .map(({ bp, campaign }) => ({
      id: uuidv4(),
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      platform: bp.platform,
      metric: 'roas',
      severity: 'high' as const,
      expected_value: 2.5,
      actual_value: 0.92,
      deviation_percent: -63.2,
      detected_at: new Date(now.getTime() - 2 * 86_400_000).toISOString(),
      description: `${bp.name} ROAS collapsed from 2.5x to 0.92x over the last 7 days (−63%). Top hypothesis: creative fatigue; the seed audience is saturating.`,
      recommendation: `Pause "${bp.name}" or rotate creatives immediately; reallocate budget to top performers.`,
    }));

  for (const alert of alerts) {
    await s.addAlert(alert);
  }

  return {
    connections: 2,
    campaigns: campaigns.length,
    metrics_days: DAYS,
    metrics_rows: metrics.length,
    alerts: alerts.length,
    message: `Demo ad portfolio seeded: 2 platform connections (Google + Meta), ${campaigns.length} campaigns, ${DAYS} days of daily metrics (${metrics.length} rows total), and ${alerts.length} anomaly alerts on underperforming campaigns. Use tools like ads_report, budget_analyze, anomaly_detect, or competitor_benchmark without real Google Ads or Meta Ads credentials.`,
  };
}
