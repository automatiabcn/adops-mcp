/**
 * Meta Ads CSV importer.
 *
 * Accepts CSV exports from:
 *  - Meta Ads Manager → Export → Campaigns (CSV)
 *  - Meta Ads Manager → Export → Campaigns + Time segmentation (Day)
 *  - Meta Marketing API JSON-to-CSV conversions
 *
 * Meta-specific columns:
 *  - "Amount spent (USD)" / "Amount spent (EUR)" / etc. — currency in the column name
 *  - "Results" — depends on campaign objective (Purchases, Leads, Messaging conversations)
 *  - "CTR (all)" vs "CTR (link click-through rate)" — we prefer link CTR
 *  - "CPC (cost per link click)" vs "CPC (all)" — we prefer link CPC
 *
 * Two supported report shapes:
 *  1. Aggregate report — 1 row per campaign
 *  2. Day-segmented report — 1 row per (campaign, day)
 */

import { v4 as uuidv4 } from 'uuid';
import { parseCsv, parseNumber, detectDelimiter, type CsvRow } from '../../utils/csv.js';
import type {
  UnifiedCampaign, UnifiedMetrics, PlatformConnection,
  CampaignStatus, CampaignObjective,
} from '../../models/adops.js';

// ── Column alias maps ───────────────────────────────────────────────

const COLS = {
  campaignName: ['Campaign name', 'Campaign', 'campaign_name'],
  campaignId: ['Campaign ID', 'campaign_id'],
  status: ['Delivery status', 'Campaign Delivery', 'Status', 'delivery_status'],
  objective: ['Campaign objective', 'Objective', 'objective'],
  budget: ['Campaign budget', 'Budget', 'Daily Budget', 'budget'],
  startDate: ['Starts', 'Campaign start date', 'Reporting starts'],
  endDate: ['Ends', 'Campaign end date', 'Reporting ends'],
  day: ['Day', 'Date', 'Reporting day', 'date_start'],
  impressions: ['Impressions', 'impressions'],
  reach: ['Reach', 'reach'],
  frequency: ['Frequency', 'frequency'],
  clicks: ['Link clicks', 'Clicks (all)', 'Clicks', 'link_clicks', 'clicks'],
  spend: [
    'Amount spent (USD)', 'Amount spent (EUR)', 'Amount spent (GBP)',
    'Amount spent (CAD)', 'Amount spent (AUD)', 'Amount spent (TRY)',
    'Amount spent (INR)', 'Amount spent (BRL)', 'Amount spent (JPY)',
    'Amount spent', 'amount_spent', 'spend',
  ],
  results: ['Results', 'Purchases', 'Leads', 'results'],
  conversionValue: [
    'Purchases conversion value', 'Website purchases conversion value',
    'Purchase ROAS (return on ad spend)', 'Conversion value', 'purchase_value',
  ],
  ctr: ['CTR (link click-through rate)', 'CTR (all)', 'CTR', 'ctr'],
  cpc: ['CPC (cost per link click)', 'CPC (all)', 'CPC', 'cpc'],
  currency: ['Currency', 'account_currency'],
};

function findCol(row: CsvRow, aliases: string[]): string | undefined {
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

/** Detect currency from column name like "Amount spent (EUR)" → "EUR" */
function detectCurrency(row: CsvRow): string {
  for (const key of Object.keys(row)) {
    const m = key.match(/Amount spent \(([A-Z]{3})\)/i);
    if (m) return m[1].toUpperCase();
  }
  const explicit = findCol(row, COLS.currency);
  if (explicit && /^[A-Z]{3}$/i.test(explicit.trim())) return explicit.trim().toUpperCase();
  return 'USD';
}

function mapStatus(raw: string | undefined): CampaignStatus {
  const s = (raw ?? '').toLowerCase().trim();
  if (s.includes('active') || s.includes('delivering') || s === 'enabled') return 'active';
  if (s.includes('paused') || s.includes('not delivering')) return 'paused';
  if (s.includes('deleted') || s.includes('removed')) return 'removed';
  if (s.includes('completed') || s.includes('ended')) return 'completed';
  if (s.includes('scheduled') || s.includes('in review') || s.includes('draft')) return 'draft';
  return 'active';
}

function mapObjective(raw: string | undefined): CampaignObjective {
  const s = (raw ?? '').toLowerCase().trim();
  if (s.includes('awareness') || s.includes('brand')) return 'awareness';
  if (s.includes('reach')) return 'reach';
  if (s.includes('traffic') || s.includes('link clicks')) return 'traffic';
  if (s.includes('engagement') || s.includes('post engagement') || s.includes('page likes')) return 'engagement';
  if (s.includes('lead')) return 'leads';
  if (s.includes('conversion') && !s.includes('sales')) return 'conversions';
  if (s.includes('sale') || s.includes('purchase') || s.includes('catalog')) return 'sales';
  if (s.includes('app install')) return 'app_installs';
  if (s.includes('video views')) return 'video_views';
  return 'conversions';
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
    detected_currency: string;
  };
}

export function importMetaAdsCsv(
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

  const sampleRow = rows[0];
  const detectedCurrency = sampleRow ? detectCurrency(sampleRow) : 'USD';
  const hasTimeSegmentation = sampleRow ? findCol(sampleRow, COLS.day) !== undefined : false;

  if (rows.length === 0) {
    warnings.push('CSV has headers but no data rows. Nothing to import — check that the export includes campaign rows.');
  }

  const nowIso = new Date().toISOString();
  const connection: PlatformConnection = {
    id: uuidv4(),
    platform: 'meta',
    name: options.connection_name ?? 'Meta Ads (CSV Import)',
    account_id: options.account_id ?? `act_csv-${Date.now()}`,
    connected_at: nowIso,
    last_sync_at: nowIso,
    status: 'active',
  };

  const campaignMap = new Map<string, UnifiedCampaign>();
  const metricsRows: UnifiedMetrics[] = [];
  let rowsSkipped = 0;

  for (const row of rows) {
    const name = findCol(row, COLS.campaignName);
    if (!name || name.trim() === '') {
      rowsSkipped++;
      continue;
    }

    const platformCampaignId = findCol(row, COLS.campaignId) ?? `meta-${name}`;
    const key = platformCampaignId;

    let campaign = campaignMap.get(key);
    if (!campaign) {
      const rawBudget = findCol(row, COLS.budget);
      const dailyBudget = parseNumber(rawBudget);

      campaign = {
        id: uuidv4(),
        platform: 'meta',
        platform_campaign_id: platformCampaignId,
        connection_id: connection.id,
        name: name.trim(),
        status: mapStatus(findCol(row, COLS.status)),
        objective: mapObjective(findCol(row, COLS.objective)),
        bidding_strategy: null,
        daily_budget: dailyBudget,
        total_budget: null,
        currency: detectedCurrency,
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

    // Metrics
    const impressions = Math.round(parseNumber(findCol(row, COLS.impressions)));
    const reach = Math.round(parseNumber(findCol(row, COLS.reach)));
    const frequency = parseNumber(findCol(row, COLS.frequency));
    const clicks = Math.round(parseNumber(findCol(row, COLS.clicks)));
    const spend = parseNumber(findCol(row, COLS.spend));
    const conversions = parseNumber(findCol(row, COLS.results));
    const conversionValue = parseNumber(findCol(row, COLS.conversionValue));

    if (impressions === 0 && clicks === 0 && spend === 0) {
      continue;
    }

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
      platform: 'meta',
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
      reach: reach > 0 ? reach : null,
      frequency: frequency > 0 ? frequency : null,
      quality_score: null,
      video_views: null,
    });
  }

  if (campaignMap.size === 0) {
    warnings.push('No campaigns found in CSV. Check that you exported a Campaigns-level report (not Ad sets or Ads).');
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
      detected_currency: detectedCurrency,
    },
  };
}

function normalizeDate(raw: string): string {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}
