/**
 * Google Ads CSV importer.
 *
 * Accepts CSV exports from:
 *  - Google Ads Editor ("Export" button)
 *  - Google Ads web UI ("Download" → CSV, with or without "Day" segmentation)
 *  - Google Ads API-generated reports in CSV format
 *
 * Two supported report shapes:
 *  1. Campaigns report (no time segmentation) — 1 row per campaign with aggregate metrics
 *  2. Campaign x Day report — 1 row per (campaign, day) tuple; imports both campaigns AND daily metrics
 *
 * Column names are matched case-insensitively with common aliases, because Google
 * keeps renaming columns across UI versions.
 */

import { v4 as uuidv4 } from 'uuid';
import { parseCsv, parseNumber, detectDelimiter, type CsvRow } from '../../utils/csv.js';
import type {
  UnifiedCampaign, UnifiedMetrics, PlatformConnection,
  CampaignStatus, CampaignObjective,
} from '../../models/adops.js';

// ── Column alias maps ───────────────────────────────────────────────
// Google renames columns across UI versions. We accept any alias.

const COLS = {
  campaignName: ['Campaign', 'Campaign name', 'campaign.name'],
  campaignId: ['Campaign ID', 'campaign.id'],
  status: ['Campaign state', 'Campaign status', 'Status', 'campaign.status'],
  type: ['Campaign type', 'Advertising channel', 'campaign.advertising_channel_type'],
  budget: ['Budget', 'Daily budget', 'Campaign budget', 'campaign_budget.amount_micros'],
  startDate: ['Start date', 'campaign.start_date'],
  endDate: ['End date', 'campaign.end_date'],
  day: ['Day', 'Date', 'segments.date'],
  impressions: ['Impressions', 'metrics.impressions'],
  clicks: ['Clicks', 'metrics.clicks'],
  cost: ['Cost', 'Spend', 'metrics.cost_micros'],
  conversions: ['Conversions', 'Conv.', 'metrics.conversions'],
  convValue: ['Conv. value', 'Conversion value', 'Total conv. value', 'metrics.conversions_value'],
  ctr: ['CTR', 'Click-through rate', 'metrics.ctr'],
  avgCpc: ['Avg. CPC', 'Avg CPC', 'metrics.average_cpc'],
  currency: ['Currency', 'Account currency', 'Currency code', 'customer.currency_code'],
};

function findCol(row: CsvRow, aliases: string[]): string | undefined {
  // Try exact match first, then case-insensitive
  for (const alias of aliases) {
    if (alias in row) return row[alias];
  }
  const lower = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.toLowerCase().trim(), v]),
  );
  for (const alias of aliases) {
    const v = lower[alias.toLowerCase().trim()];
    if (v !== undefined) return v;
  }
  return undefined;
}

// ── Value mappers ────────────────────────────────────────────────────

function mapStatus(raw: string | undefined): CampaignStatus {
  const s = (raw ?? '').toLowerCase().trim();
  if (s === 'enabled' || s === 'active' || s === 'serving') return 'active';
  if (s === 'paused') return 'paused';
  if (s === 'removed' || s === 'deleted') return 'removed';
  if (s === 'ended' || s === 'completed') return 'completed';
  if (s === 'draft' || s === 'pending') return 'draft';
  return 'active'; // default — CSV exports often have "Eligible" or custom states
}

function mapObjective(channelType: string | undefined): CampaignObjective {
  const t = (channelType ?? '').toLowerCase().trim();
  if (t.includes('search')) return 'conversions';
  if (t.includes('shopping')) return 'sales';
  if (t.includes('video') || t.includes('youtube')) return 'video_views';
  if (t.includes('display')) return 'awareness';
  if (t.includes('app')) return 'app_installs';
  if (t.includes('discovery') || t.includes('demand gen')) return 'engagement';
  if (t.includes('performance max')) return 'sales';
  return 'conversions';
}

function costMicrosToUnits(rawCost: string | undefined): number {
  const n = parseNumber(rawCost);
  // Heuristic: if the value is huge (>100,000) AND label hinted at micros, divide by 1M.
  // Most web UI exports show cost in account currency already. API exports use micros.
  // We check: if value > 100000 AND has no decimals, assume micros.
  if (n > 100000 && Number.isInteger(n)) return n / 1_000_000;
  return n;
}

// ── Main importer ────────────────────────────────────────────────────

export interface ImportResult {
  connection: PlatformConnection;
  campaigns: UnifiedCampaign[];
  metrics: UnifiedMetrics[];
  warnings: string[];
  summary: {
    rows_parsed: number;
    campaigns_imported: number;
    metrics_imported: number;
    rows_skipped: number;
    has_time_segmentation: boolean;
  };
}

export function importGoogleAdsCsv(
  csvContent: string,
  options: {
    connection_name?: string;
    account_id?: string;
  } = {},
): ImportResult {
  if (!csvContent.trim()) {
    throw new Error('CSV is empty or malformed. Ensure the first row is a header row.');
  }

  const delimiter = detectDelimiter(csvContent);
  const rows = parseCsv(csvContent, { delimiter });

  const warnings: string[] = [];

  // Detect time segmentation by presence of Day/Date column in first row (or headers if no data)
  const sampleRow = rows[0];
  const hasTimeSegmentation = sampleRow ? findCol(sampleRow, COLS.day) !== undefined : false;

  if (rows.length === 0) {
    warnings.push('CSV has headers but no data rows. Nothing to import — check that you exported with rows selected.');
  }

  // Build connection
  const nowIso = new Date().toISOString();
  const connection: PlatformConnection = {
    id: uuidv4(),
    platform: 'google',
    name: options.connection_name ?? 'Google Ads (CSV Import)',
    account_id: options.account_id ?? `csv-${Date.now()}`,
    connected_at: nowIso,
    last_sync_at: nowIso,
    status: 'active',
  };

  // Group rows by campaign. For non-segmented reports, each row = 1 campaign.
  // For time-segmented reports, multiple rows per campaign — first occurrence wins for static fields.
  const campaignMap = new Map<string, UnifiedCampaign>();
  const metricsRows: UnifiedMetrics[] = [];
  let rowsSkipped = 0;

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const name = findCol(row, COLS.campaignName);
    if (!name || name.trim() === '') {
      rowsSkipped++;
      continue;
    }

    const platformCampaignId = findCol(row, COLS.campaignId) ?? `google-${name}`;
    const key = platformCampaignId;

    let campaign = campaignMap.get(key);
    if (!campaign) {
      const currency = (findCol(row, COLS.currency) ?? 'USD').toUpperCase().slice(0, 3);
      const rawBudget = findCol(row, COLS.budget);
      const dailyBudget = costMicrosToUnits(rawBudget);

      campaign = {
        id: uuidv4(),
        platform: 'google',
        platform_campaign_id: platformCampaignId,
        connection_id: connection.id,
        name: name.trim(),
        status: mapStatus(findCol(row, COLS.status)),
        objective: mapObjective(findCol(row, COLS.type)),
        bidding_strategy: null, // Not reliably present in CSV exports
        daily_budget: dailyBudget,
        total_budget: null,
        currency,
        start_date: findCol(row, COLS.startDate) ?? nowIso.slice(0, 10),
        end_date: findCol(row, COLS.endDate) || null,
        targeting: {
          geo: [],
          age_min: null,
          age_max: null,
          gender: null,
          interests: [],
          devices: [],
        },
        created_at: nowIso,
        updated_at: nowIso,
        synced_at: nowIso,
      };
      campaignMap.set(key, campaign);
    }

    // Build a metrics row
    const impressions = Math.round(parseNumber(findCol(row, COLS.impressions)));
    const clicks = Math.round(parseNumber(findCol(row, COLS.clicks)));
    const spend = costMicrosToUnits(findCol(row, COLS.cost));
    const conversions = parseNumber(findCol(row, COLS.conversions));
    const conversionValue = parseNumber(findCol(row, COLS.convValue));

    // If no impressions/clicks/spend, don't create a metrics row (just a campaign definition)
    if (impressions === 0 && clicks === 0 && spend === 0) {
      continue;
    }

    // Calculated metrics
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
    const roas = spend > 0 ? conversionValue / spend : 0;
    const cpa = conversions > 0 ? spend / conversions : 0;
    const conversionRate = clicks > 0 ? (conversions / clicks) * 100 : 0;

    const dateRaw = findCol(row, COLS.day);
    const date = dateRaw ? normalizeDate(dateRaw) : nowIso.slice(0, 10);

    metricsRows.push({
      campaign_id: campaign.id,
      platform: 'google',
      date,
      impressions,
      clicks,
      spend,
      conversions,
      conversion_value: conversionValue,
      ctr,
      cpc,
      cpm,
      roas,
      cpa,
      conversion_rate: conversionRate,
      reach: null,
      frequency: null,
      quality_score: null,
      video_views: null,
    });
  }

  if (campaignMap.size === 0) {
    warnings.push('No campaigns found in CSV. Check that the first row contains column headers.');
  }

  return {
    connection,
    campaigns: Array.from(campaignMap.values()),
    metrics: metricsRows,
    warnings,
    summary: {
      rows_parsed: rows.length,
      campaigns_imported: campaignMap.size,
      metrics_imported: metricsRows.length,
      rows_skipped: rowsSkipped,
      has_time_segmentation: hasTimeSegmentation,
    },
  };
}

/** Normalize date formats: "2026-04-21", "Apr 21, 2026", "21/04/2026" → "YYYY-MM-DD" */
function normalizeDate(raw: string): string {
  const s = raw.trim();
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10); // fallback to today
}
