/**
 * Export budget-analysis recommendations in actionable formats.
 *
 * Community insight (Reddit / Blend, blendmcp.com): "the part that's surprised
 * us most is how much people use the write side — typing stuff like 'pause
 * anything with CPA over 50 and shift that budget to my top 3 performers'".
 *
 * AdOps is a CSV-first analytics tool (no live write API), so we close the
 * loop by exporting recommendations in formats the user can paste straight
 * into Google Ads Editor or Meta Ads Manager bulk-edit screens. That turns
 * "AI-generated plan" into "one-step bulk action" without needing Google/Meta
 * OAuth + developer-token approval queues.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { analyzeBudget } from './optimizer.js';
import { storage as defaultStorage, Storage } from './storage.js';
import type { BudgetAnalysis, Platform } from '../models/adops.js';

export type ExportFormat = 'google_ads_csv' | 'meta_ads_csv' | 'json' | 'markdown';

export interface ExportOptions {
  /** Output format. Choose one per platform — Google Ads Editor and Meta Ads Manager
   *  expect different column sets. */
  format: ExportFormat;
  /** If set, write the output to this absolute file path. Otherwise, return inline
   *  as a string. */
  output_path?: string;
  /** Optimization goal fed to analyzeBudget. Defaults to maximize_roas. */
  optimization_goal?: 'maximize_roas' | 'maximize_conversions' | 'minimize_cpa';
  /** Restrict analysis to a single platform. */
  platform?: Platform;
  /** Minimum confidence or severity filter — only export recommendations whose
   *  budget delta meets this threshold (as a fraction, e.g. 0.1 = 10%). */
  min_delta_pct?: number;
  /** Limit to top N recommendations by priority order. Default 50 (max 100). */
  limit?: number;
}

export interface ExportResult {
  format: ExportFormat;
  rows_exported: number;
  content?: string;           // inline mode
  file_written?: string;       // file mode
  summary: {
    total_recommendations: number;
    filtered_out: number;
    by_type: Record<string, number>;
  };
  next_steps: string[];
}

/** CSV escape per RFC 4180 — wrap cells containing commas, quotes, or newlines. */
function csvCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toGoogleAdsEditorCsv(
  recommendations: BudgetAnalysis['recommendations'],
): string {
  // Google Ads Editor bulk upload format — "Campaign", "Status", "Budget" columns
  // match the same headers Google exports, so the CSV re-imports cleanly.
  const header = ['Campaign', 'Action', 'Status', 'Budget', 'Reason', 'Expected Impact'];
  const rows = recommendations
    .filter((r) => r.platform === 'google')
    .map((r) => [
      csvCell(r.campaign_name),
      csvCell(r.type),
      csvCell(r.type === 'pause' ? 'Paused' : ''),
      csvCell(r.suggested_budget),
      csvCell(r.reason),
      csvCell(r.expected_impact),
    ].join(','));
  return [header.join(','), ...rows].join('\n');
}

function toMetaAdsCsv(
  recommendations: BudgetAnalysis['recommendations'],
): string {
  // Meta Ads Manager bulk-edit CSV has its own column names
  const header = ['Campaign name', 'Action', 'Campaign status', 'Campaign budget', 'Reason', 'Expected impact'];
  const rows = recommendations
    .filter((r) => r.platform === 'meta')
    .map((r) => [
      csvCell(r.campaign_name),
      csvCell(r.type),
      csvCell(r.type === 'pause' ? 'Paused' : ''),
      csvCell(r.suggested_budget),
      csvCell(r.reason),
      csvCell(r.expected_impact),
    ].join(','));
  return [header.join(','), ...rows].join('\n');
}

function toMarkdown(
  analysis: BudgetAnalysis,
  recommendations: BudgetAnalysis['recommendations'],
  goal: string,
): string {
  const lines: string[] = [];
  lines.push('# AdOps Budget Recommendations');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Optimization goal: ${goal}`);
  lines.push(`Total daily budget: $${analysis.total_daily_budget.toFixed(2)}`);
  lines.push(`Total spend (last 7d avg): $${analysis.total_spend_today.toFixed(2)}`);
  lines.push('');
  if (recommendations.length === 0) {
    lines.push('_No recommendations at this time. Budget allocation looks healthy._');
    return lines.join('\n');
  }
  lines.push('## Recommendations');
  lines.push('');
  for (const r of recommendations) {
    const delta = r.suggested_budget - r.current_budget;
    const sign = delta >= 0 ? '+' : '';
    lines.push(`### ${r.type.toUpperCase()}: ${r.campaign_name} (${r.platform})`);
    lines.push(`- Current budget: $${r.current_budget}/day`);
    lines.push(`- Suggested: $${r.suggested_budget}/day (${sign}$${delta.toFixed(2)})`);
    lines.push(`- Reason: ${r.reason}`);
    lines.push(`- Expected impact: ${r.expected_impact}`);
    lines.push('');
  }
  return lines.join('\n');
}

function countByType(recs: BudgetAnalysis['recommendations']): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of recs) {
    counts[r.type] = (counts[r.type] ?? 0) + 1;
  }
  return counts;
}

/** Apply filters, then serialize to the requested format, and optionally write to disk. */
export async function exportRecommendations(
  options: ExportOptions,
  store?: Storage,
): Promise<ExportResult> {
  const s = store ?? defaultStorage;
  const goal = options.optimization_goal ?? 'maximize_roas';
  const analysis = await analyzeBudget(goal, options.platform, s);

  const totalRecs = analysis.recommendations.length;
  let filtered = analysis.recommendations;

  // Filter by minimum delta percentage
  if (options.min_delta_pct !== undefined) {
    const minPct = options.min_delta_pct;
    filtered = filtered.filter((r) => {
      if (r.current_budget === 0) return true; // always include new allocations
      const deltaPct = Math.abs(r.suggested_budget - r.current_budget) / r.current_budget;
      return deltaPct >= minPct;
    });
  }

  // Limit to top N
  const limit = Math.min(options.limit ?? 50, 100);
  filtered = filtered.slice(0, limit);

  const filteredOut = totalRecs - filtered.length;

  // Serialize
  let content: string;
  switch (options.format) {
    case 'google_ads_csv':
      content = toGoogleAdsEditorCsv(filtered);
      break;
    case 'meta_ads_csv':
      content = toMetaAdsCsv(filtered);
      break;
    case 'json':
      content = JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          optimization_goal: goal,
          platform: options.platform ?? 'all',
          total_recommendations: totalRecs,
          exported: filtered.length,
          recommendations: filtered,
        },
        null,
        2,
      );
      break;
    case 'markdown':
      content = toMarkdown(analysis, filtered, goal);
      break;
    default:
      throw new Error(`Unknown export format: ${options.format}`);
  }

  // Optionally write to disk
  let fileWritten: string | undefined;
  if (options.output_path) {
    const dir = path.dirname(options.output_path);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(options.output_path, content, 'utf-8');
    fileWritten = options.output_path;
  }

  const nextSteps: string[] = [];
  if (options.format === 'google_ads_csv') {
    nextSteps.push(
      'Open Google Ads Editor → File → Import → Paste from clipboard OR upload CSV',
      'Review proposed changes in the diff view before posting',
      'Commit changes to your Google Ads account',
    );
  } else if (options.format === 'meta_ads_csv') {
    nextSteps.push(
      'Open Meta Ads Manager → Campaigns → select rows → Edit → Bulk Edit',
      'Or use Meta Ads Manager Import CSV (Power Editor)',
      'Review and publish changes',
    );
  } else if (options.format === 'json') {
    nextSteps.push('Pipe this JSON into n8n, Zapier, or your own script for automated execution.');
  } else {
    nextSteps.push('Paste this markdown into a standup document or ticket for team review.');
  }

  return {
    format: options.format,
    rows_exported: filtered.length,
    content: fileWritten ? undefined : content,
    file_written: fileWritten,
    summary: {
      total_recommendations: totalRecs,
      filtered_out: filteredOut,
      by_type: countByType(filtered),
    },
    next_steps: nextSteps,
  };
}
