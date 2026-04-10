import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { storage } from './services/storage.js';
import { generatePerformanceReport, generateAudienceInsights, generateBenchmark, forecastSpend } from './services/analytics.js';
import { analyzeBudget, reallocateBudget } from './services/optimizer.js';
import { detectAnomalies } from './services/anomaly.js';
import { analyzeABTest } from './services/ab-test.js';
import { getCreativeSpecs } from './services/creative-specs.js';
import { seedDemoAdPortfolio } from './services/demo-seed.js';
import { handleToolError } from './utils/errors.js';
import {
  PlatformSchema, CampaignStatusSchema, CampaignObjectiveSchema, BiddingStrategySchema,
  PlatformConnectInputSchema, CampaignListInputSchema, CampaignCreateInputSchema,
  CampaignUpdateInputSchema, CampaignPauseResumeInputSchema, AdsReportInputSchema,
  BudgetAnalyzeInputSchema, BudgetReallocateInputSchema, AudienceInsightsInputSchema,
  CreativeSpecsInputSchema, AnomalyDetectInputSchema, ABTestAnalyzeInputSchema,
  CompetitorBenchmarkInputSchema, ForecastSpendInputSchema,
  type UnifiedCampaign, type Platform,
} from './models/adops.js';

const SERVER_VERSION = '1.1.2';
const TOOL_COUNT = 15;
const RESOURCE_COUNT = 4;

const server = new McpServer({ name: 'adops-mcp', version: SERVER_VERSION });

// ── Tool 0: ad_demo_seed ────────────────────────────────────────────

server.registerTool(
  'ad_demo_seed',
  {
    title: 'Seed Demo Ad Portfolio',
    description: 'Create a realistic cross-platform ad portfolio so you can explore AdOps without real Google Ads or Meta Ads credentials. Seeds 2 platform connections (Google + Meta), 8 campaigns covering different objectives and performance tiers (top performers, mid-tier, and underperformers), 30 days of daily metrics per campaign (240 metric rows total), and pre-computed anomaly alerts on the worst performers. Every AdOps tool (ads_report, budget_analyze, anomaly_detect, competitor_benchmark, ab_test_analyze, forecast_spend) will return meaningful output immediately. Safe to call multiple times — each call appends a new portfolio. Returns counts of everything created.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async () => {
    try {
      const result = await seedDemoAdPortfolio();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (e) { return handleToolError(e); }
  },
);

// ── Tool 1: platform_connect ────────────────────────────────────────

server.registerTool(
  'platform_connect',
  {
    title: 'Connect Ad Platform',
    description: 'Register a Google Ads or Meta Ads account in the AdOps workspace so subsequent tools (campaign_list, campaign_create, ads_report) can target it. Input: platform ("google_ads"|"meta_ads"), name (display label), account_id (the external ad account id). Returns the stored connection object with a generated UUID and status="active". Safe to call with the same platform+account_id — returns the existing connection instead of erroring (idempotent).',
    inputSchema: PlatformConnectInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ platform, name, account_id }) => {
    try {
      const existing = await storage.getAllConnections();
      const duplicate = existing.find((c) => c.platform === platform && c.account_id === account_id);
      if (duplicate) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({
          message: 'Connection already exists',
          connection: duplicate,
        }, null, 2) }] };
      }

      const conn = await storage.addConnection({
        id: uuidv4(),
        platform,
        name,
        account_id,
        connected_at: new Date().toISOString(),
        last_sync_at: null,
        status: 'active',
      });

      return { content: [{ type: 'text' as const, text: JSON.stringify({
        message: `Successfully connected ${platform} account "${name}"`,
        connection: conn,
      }, null, 2) }] };
    } catch (e) { return handleToolError(e); }
  },
);

// ── Tool 2: campaign_list ───────────────────────────────────────────

server.registerTool(
  'campaign_list',
  {
    title: 'List Campaigns',
    description: 'Unified listing of campaigns across Google Ads and Meta Ads in a single view. Optional filters: platform ("google_ads"|"meta_ads"), status ("draft"|"active"|"paused"|"ended"|"archived"), query (free-text over campaign name). Pagination via limit (default 20, max 100) and offset. Returns {total, showing, offset, campaigns[]} where each campaign summary includes id, name, platform, status, objective, daily_budget, currency, and start_date. Use the returned id with campaign_update, campaign_pause_resume, or ab_test_analyze.',
    inputSchema: CampaignListInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ platform, status, query, limit, offset }) => {
    try {
      const result = await storage.searchCampaigns({ platform, status, query, limit, offset });
      return { content: [{ type: 'text' as const, text: JSON.stringify({
        total: result.total,
        showing: result.campaigns.length,
        offset: offset ?? 0,
        campaigns: result.campaigns.map((c) => ({
          id: c.id,
          name: c.name,
          platform: c.platform,
          status: c.status,
          objective: c.objective,
          daily_budget: c.daily_budget,
          currency: c.currency,
          start_date: c.start_date,
        })),
      }, null, 2) }] };
    } catch (e) { return handleToolError(e); }
  },
);

// ── Tool 3: campaign_create ─────────────────────────────────────────

server.registerTool(
  'campaign_create',
  {
    title: 'Create Campaign',
    description: 'Create a new ad campaign in the AdOps workspace. Accepts unified parameters (platform, name, objective, bidding_strategy, daily_budget, currency, start_date, end_date, targeting) and stores a canonical UnifiedCampaign record with status="draft". Returns the created campaign summary plus next_steps guidance. Requires an active platform connection (see platform_connect) — will auto-associate the first active connection for the chosen platform.',
    inputSchema: CampaignCreateInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => {
    try {
      // Find an active connection for this platform
      const connections = await storage.getConnectionsByPlatform(input.platform);
      const activeConn = connections.find((c) => c.status === 'active');
      const connectionId = activeConn?.id ?? uuidv4();

      const now = new Date().toISOString();
      const campaign: UnifiedCampaign = {
        id: uuidv4(),
        platform: input.platform,
        platform_campaign_id: `${input.platform}_${Date.now()}`,
        connection_id: connectionId,
        name: input.name,
        status: 'draft',
        objective: input.objective,
        bidding_strategy: input.bidding_strategy ?? null,
        daily_budget: input.daily_budget,
        total_budget: null,
        currency: input.currency ?? 'USD',
        start_date: input.start_date ?? now.split('T')[0],
        end_date: input.end_date ?? null,
        targeting: {
          geo: input.targeting?.geo ?? [],
          age_min: input.targeting?.age_min ?? null,
          age_max: input.targeting?.age_max ?? null,
          gender: input.targeting?.gender ?? null,
          interests: input.targeting?.interests ?? [],
          devices: input.targeting?.devices ?? [],
        },
        created_at: now,
        updated_at: now,
        synced_at: null,
      };

      await storage.addCampaign(campaign);

      return { content: [{ type: 'text' as const, text: JSON.stringify({
        message: `Campaign "${campaign.name}" created successfully on ${campaign.platform}`,
        campaign: {
          id: campaign.id,
          name: campaign.name,
          platform: campaign.platform,
          status: campaign.status,
          objective: campaign.objective,
          daily_budget: campaign.daily_budget,
          currency: campaign.currency,
          start_date: campaign.start_date,
        },
        next_steps: [
          'Set status to "active" to start the campaign',
          'Add ad creatives to start serving ads',
          'Configure targeting for optimal reach',
        ],
      }, null, 2) }] };
    } catch (e) { return handleToolError(e); }
  },
);

// ── Tool 4: campaign_update ─────────────────────────────────────────

server.registerTool(
  'campaign_update',
  {
    title: 'Update Campaign',
    description: 'Patch-update an existing campaign. Pass campaign_id (UUID from campaign_list or campaign_create) plus any subset of: name, status, daily_budget, bidding_strategy, end_date. Fields you omit are left unchanged. Returns {message, updated_fields[], campaign} or an error if campaign_id is not found. Prefer campaign_pause_resume for batch status changes.',
    inputSchema: CampaignUpdateInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ campaign_id, ...updates }) => {
    try {
      const campaign = await storage.updateCampaign(campaign_id, updates);
      if (!campaign) {
        return { content: [{ type: 'text' as const, text: `Campaign "${campaign_id}" not found.` }], isError: true };
      }

      return { content: [{ type: 'text' as const, text: JSON.stringify({
        message: `Campaign "${campaign.name}" updated successfully`,
        updated_fields: Object.keys(updates).filter((k) => updates[k as keyof typeof updates] !== undefined),
        campaign: {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          daily_budget: campaign.daily_budget,
          bidding_strategy: campaign.bidding_strategy,
        },
      }, null, 2) }] };
    } catch (e) { return handleToolError(e); }
  },
);

// ── Tool 5: campaign_pause_resume ───────────────────────────────────

server.registerTool(
  'campaign_pause_resume',
  {
    title: 'Pause or Resume Campaigns',
    description: 'Batch-change the status of up to 50 campaigns in one call. action="pause" sets status to "paused"; action="resume" sets status to "active". Missing campaign_ids are reported in the errors array but do not fail the whole batch. Returns {action, updated, failed, campaigns[], errors?}. Use this for emergency pause during an incident or weekend shutoff.',
    inputSchema: CampaignPauseResumeInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ campaign_ids, action }) => {
    try {
      const newStatus = action === 'pause' ? 'paused' : 'active';
      const results: { id: string; name: string; status: string }[] = [];
      const errors: string[] = [];

      for (const id of campaign_ids) {
        const updated = await storage.updateCampaign(id, { status: newStatus as UnifiedCampaign['status'] });
        if (updated) {
          results.push({ id: updated.id, name: updated.name, status: updated.status });
        } else {
          errors.push(`Campaign ${id} not found`);
        }
      }

      return { content: [{ type: 'text' as const, text: JSON.stringify({
        action,
        updated: results.length,
        failed: errors.length,
        campaigns: results,
        errors: errors.length > 0 ? errors : undefined,
      }, null, 2) }] };
    } catch (e) { return handleToolError(e); }
  },
);

// ── Tool 6: ads_report ──────────────────────────────────────────────

server.registerTool(
  'ads_report',
  {
    title: 'Cross-Platform Performance Report',
    description: 'Aggregate performance metrics across Google Ads and Meta Ads into a single unified view. Input: date_range ({start, end} as YYYY-MM-DD, defaults to the last 7 days), optional platform filter, optional campaign_ids filter, optional sort_by ("spend"|"roas"|"conversions"|"ctr"|"cpc"), and limit. Returns {period, totals (spend, impressions, clicks, conversions, revenue, ROAS, CPC, CTR), by_platform, campaigns[] (sorted per sort_by), top_performers, underperformers}. This is the entry point for most analysis workflows.',
    inputSchema: AdsReportInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ platform, date_range, campaign_ids, sort_by, limit }) => {
    try {
      const now = new Date();
      const defaultEnd = now.toISOString().split('T')[0];
      const defaultStart = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];

      const report = await generatePerformanceReport(
        date_range?.start ?? defaultStart,
        date_range?.end ?? defaultEnd,
        platform,
        campaign_ids,
        sort_by,
        limit,
      );

      return { content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }] };
    } catch (e) { return handleToolError(e); }
  },
);

// ── Tool 7: budget_analyze ──────────────────────────────────────────

server.registerTool(
  'budget_analyze',
  {
    title: 'Budget Analysis & Optimization',
    description: 'Analyze how the current ad budget is distributed and produce actionable reallocation recommendations. Input: optimization_goal ("maximize_roas"|"maximize_conversions"|"minimize_cpa") and optional platform filter. Returns {goal, current_allocation (by platform + campaign), recommendations[] (each with campaign_id, current_budget, suggested_budget, rationale, expected_impact), projected_lift}. Pair with budget_reallocate to execute the recommendations.',
    inputSchema: BudgetAnalyzeInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ platform, optimization_goal }) => {
    try {
      const analysis = await analyzeBudget(optimization_goal, platform);
      return { content: [{ type: 'text' as const, text: JSON.stringify(analysis, null, 2) }] };
    } catch (e) { return handleToolError(e); }
  },
);

// ── Tool 8: budget_reallocate ───────────────────────────────────────

server.registerTool(
  'budget_reallocate',
  {
    title: 'Reallocate Budget',
    description: 'Transfer a dollar amount from one campaign\'s daily budget to another. Works across platforms (e.g. shift $50/day from a Google Ads search campaign to a Meta Ads retargeting campaign). Input: from_campaign_id, to_campaign_id (UUIDs, must differ), amount (positive number in campaign currency). Rejects the call if from_campaign_id === to_campaign_id or if the source campaign would go below zero. Returns the updated budgets for both campaigns.',
    inputSchema: BudgetReallocateInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ from_campaign_id, to_campaign_id, amount }) => {
    try {
      if (from_campaign_id === to_campaign_id) {
        return { content: [{ type: 'text' as const, text: 'from_campaign_id and to_campaign_id must be different campaigns.' }], isError: true };
      }
      if (amount <= 0) {
        return { content: [{ type: 'text' as const, text: 'amount must be greater than zero.' }], isError: true };
      }
      const result = await reallocateBudget(from_campaign_id, to_campaign_id, amount);
      return { content: [{ type: 'text' as const, text: JSON.stringify({
        message: `Successfully reallocated $${amount}`,
        ...result,
      }, null, 2) }] };
    } catch (e) { return handleToolError(e); }
  },
);

// ── Tool 9: audience_insights ───────────────────────────────────────

server.registerTool(
  'audience_insights',
  {
    title: 'Audience Insights',
    description: 'Demographic and behavioural breakdown of the audiences served by your ads. Input: platform (optional — omit for all platforms) and optional campaign_id to scope to a single campaign. Returns {age_distribution, gender_distribution, top_geos, top_interests, device_breakdown, total_impressions, engagement_rate}. Use when refining targeting or reporting audience coverage.',
    inputSchema: AudienceInsightsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ platform, campaign_id }) => {
    try {
      const insights = await generateAudienceInsights(platform, campaign_id);
      return { content: [{ type: 'text' as const, text: JSON.stringify(insights, null, 2) }] };
    } catch (e) { return handleToolError(e); }
  },
);

// ── Tool 10: creative_specs ─────────────────────────────────────────

server.registerTool(
  'creative_specs',
  {
    title: 'Creative Specifications',
    description: 'Platform-specific creative requirements for ad formats. Returns the exact image dimensions, aspect ratios, video duration and codec, headline/primary-text character limits, supported CTA buttons, and file size ceilings for each ad format. Input: platform ("google_ads"|"meta_ads") and optional format filter (e.g. "responsive_display", "video", "carousel", "single_image"). Use this before building creatives to avoid rejection at upload time.',
    inputSchema: CreativeSpecsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ platform, format }) => {
    try {
      const specs = getCreativeSpecs(platform, format);
      return { content: [{ type: 'text' as const, text: JSON.stringify({
        platform,
        format_filter: format ?? 'all',
        specs_count: specs.length,
        specs,
      }, null, 2) }] };
    } catch (e) { return handleToolError(e); }
  },
);

// ── Tool 11: anomaly_detect ─────────────────────────────────────────

server.registerTool(
  'anomaly_detect',
  {
    title: 'Detect Performance Anomalies',
    description: 'Scan campaigns for statistical anomalies vs. a rolling baseline. Flags CPC spikes, CTR drops, sudden spend surges, and conversion cliffs. Input: sensitivity ("low"|"medium"|"high" — controls the z-score threshold), lookback_days (baseline window, default 14), optional platform filter. Returns {anomalies_found, severity_breakdown (critical|high|medium|low counts), alerts[] (each with campaign_id, metric, baseline, current, deviation, severity, reason)}. Run daily to catch issues before they burn budget.',
    inputSchema: AnomalyDetectInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ platform, sensitivity, lookback_days }) => {
    try {
      const alerts = await detectAnomalies(sensitivity, lookback_days, platform);
      return { content: [{ type: 'text' as const, text: JSON.stringify({
        anomalies_found: alerts.length,
        severity_breakdown: {
          critical: alerts.filter((a) => a.severity === 'critical').length,
          high: alerts.filter((a) => a.severity === 'high').length,
          medium: alerts.filter((a) => a.severity === 'medium').length,
          low: alerts.filter((a) => a.severity === 'low').length,
        },
        alerts,
      }, null, 2) }] };
    } catch (e) { return handleToolError(e); }
  },
);

// ── Tool 12: ab_test_analyze ────────────────────────────────────────

server.registerTool(
  'ab_test_analyze',
  {
    title: 'A/B Test Analysis',
    description: 'Compare two campaigns as A/B test variants and determine statistical significance. Input: campaign_id_a, campaign_id_b, primary_metric ("ctr"|"conversion_rate"|"roas"|"cpc"|"cpa"). Runs a two-proportion z-test (or means comparison for continuous metrics), computes p-value and 95% confidence interval, identifies the winner, and returns {winner, confidence_level, p_value, lift_percent, sample_size_a, sample_size_b, significant (bool), recommendation}. Use with lift ≥5% and p<0.05 as a decision rule.',
    inputSchema: ABTestAnalyzeInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ campaign_id_a, campaign_id_b, primary_metric }) => {
    try {
      const result = await analyzeABTest(campaign_id_a, campaign_id_b, primary_metric);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) { return handleToolError(e); }
  },
);

// ── Tool 13: competitor_benchmark ───────────────────────────────────

server.registerTool(
  'competitor_benchmark',
  {
    title: 'Industry Benchmark Comparison',
    description: 'Compare your ad performance against industry averages for a chosen vertical. Input: industry (e.g. "ecommerce", "saas", "finance", "healthcare", "education", "travel", "real_estate", "legal"), optional platform filter. Returns {industry, your_metrics, benchmarks (CTR, CPC, CPM, conversion_rate, CPA, ROAS industry averages), comparison (percent above/below benchmark per metric), recommendations[]}. Benchmarks are curated static tables — not live market data.',
    inputSchema: CompetitorBenchmarkInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ industry, platform }) => {
    try {
      const benchmark = await generateBenchmark(industry, platform);
      return { content: [{ type: 'text' as const, text: JSON.stringify(benchmark, null, 2) }] };
    } catch (e) { return handleToolError(e); }
  },
);

// ── Tool 14: forecast_spend ─────────────────────────────────────────

server.registerTool(
  'forecast_spend',
  {
    title: 'Spend & Performance Forecast',
    description: 'Project future ad spend and performance based on recent historical trends. Input: period_days ("7"|"14"|"30") and optional platform filter. Uses moving-average extrapolation of spend, impressions, clicks, conversions, and revenue across the last 14 days. Returns {period_days, platform, projected (spend, impressions, clicks, conversions, revenue, ROAS, CPC, CTR), confidence_level, warnings[]}. Confidence drops when recent data is volatile or campaigns were paused.',
    inputSchema: ForecastSpendInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ period_days, platform }) => {
    try {
      const forecast = await forecastSpend(parseInt(period_days), platform);
      return { content: [{ type: 'text' as const, text: JSON.stringify(forecast, null, 2) }] };
    } catch (e) { return handleToolError(e); }
  },
);

// ── Resources ───────────────────────────────────────────────────────

server.registerResource(
  'ads-overview',
  'ads://overview',
  { title: 'Ad Operations Overview', description: 'Cross-platform dashboard with active campaigns, total spend, and key metrics', mimeType: 'application/json' },
  async (uri) => {
    try {
      const connections = await storage.getAllConnections();
      const campaigns = await storage.getAllCampaigns();
      const activeCampaigns = campaigns.filter((c) => c.status === 'active');
      const totalBudget = activeCampaigns.reduce((s, c) => s + c.daily_budget, 0);
      const platformCounts: Record<string, number> = {};
      for (const c of activeCampaigns) {
        platformCounts[c.platform] = (platformCounts[c.platform] ?? 0) + 1;
      }

      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({
        connected_platforms: connections.length,
        total_campaigns: campaigns.length,
        active_campaigns: activeCampaigns.length,
        total_daily_budget: totalBudget,
        campaigns_by_platform: platformCounts,
      }, null, 2) }] };
    } catch (e) {
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: 'Failed to load overview' }) }] };
    }
  },
);

server.registerResource(
  'ads-campaigns',
  'ads://campaigns',
  { title: 'Active Campaigns', description: 'List of all active campaigns across platforms', mimeType: 'application/json' },
  async (uri) => {
    try {
      const campaigns = await storage.getAllCampaigns();
      const active = campaigns.filter((c) => c.status === 'active');
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(active, null, 2) }] };
    } catch (e) {
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: 'Failed to load campaigns' }) }] };
    }
  },
);

server.registerResource(
  'ads-budget',
  'ads://budget',
  { title: 'Budget Allocation', description: 'Budget distribution across platforms and campaigns', mimeType: 'application/json' },
  async (uri) => {
    try {
      const campaigns = await storage.getAllCampaigns();
      const active = campaigns.filter((c) => c.status === 'active');
      const byPlatform: Record<string, { budget: number; count: number }> = {};
      for (const c of active) {
        if (!byPlatform[c.platform]) byPlatform[c.platform] = { budget: 0, count: 0 };
        byPlatform[c.platform].budget += c.daily_budget;
        byPlatform[c.platform].count++;
      }
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({
        total_daily_budget: active.reduce((s, c) => s + c.daily_budget, 0),
        by_platform: byPlatform,
        campaigns: active.map((c) => ({ name: c.name, platform: c.platform, daily_budget: c.daily_budget })),
      }, null, 2) }] };
    } catch (e) {
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: 'Failed to load budget data' }) }] };
    }
  },
);

server.registerResource(
  'ads-alerts',
  'ads://alerts',
  { title: 'Performance Alerts', description: 'Recent anomaly alerts and performance warnings', mimeType: 'application/json' },
  async (uri) => {
    try {
      const alerts = await storage.getRecentAlerts(10);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({
        total_alerts: alerts.length,
        alerts,
      }, null, 2) }] };
    } catch (e) {
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: 'Failed to load alerts' }) }] };
    }
  },
);

// ── Prompts ──────────────────────────────────────────────────────────

server.registerPrompt(
  'campaign_audit',
  { title: 'Campaign Performance Audit', description: 'Comprehensive review of all campaigns across Google Ads and Meta Ads with performance analysis and optimization recommendations.' },
  async () => ({
    messages: [{
      role: 'assistant' as const,
      content: { type: 'text' as const, text: 'I\'ll run a complete campaign audit across all platforms.\n\n1. Use `ads_report` to pull cross-platform performance\n2. Run `anomaly_detect` to find issues\n3. Use `budget_analyze` to check allocation efficiency\n4. Compare against industry benchmarks with `competitor_benchmark`\n5. Generate optimization recommendations\n\nShall I start the audit?' },
    }],
  }),
);

server.registerPrompt(
  'weekly_report',
  { title: 'Weekly Ad Performance Report', description: 'Generate a weekly summary of ad performance across all platforms with trends, alerts, and action items.' },
  async () => ({
    messages: [{
      role: 'assistant' as const,
      content: { type: 'text' as const, text: 'Let me generate your weekly ad performance report.\n\n1. Pull last 7 days with `ads_report`\n2. Compare with previous week for trends\n3. Check `anomaly_detect` for issues\n4. Forecast next week with `forecast_spend`\n5. Summarize with action items\n\nReady to generate?' },
    }],
  }),
);

server.registerPrompt(
  'budget_optimizer',
  { title: 'Budget Optimization', description: 'AI-powered analysis of budget allocation with specific reallocation recommendations to maximize ROAS.' },
  async () => ({
    messages: [{
      role: 'assistant' as const,
      content: { type: 'text' as const, text: 'I\'ll optimize your ad budget allocation.\n\n1. Analyze current spend with `budget_analyze`\n2. Identify high-ROAS campaigns to scale\n3. Find underperformers to reduce or pause\n4. Calculate cross-platform reallocation\n5. Use `forecast_spend` to project impact\n\nWhat\'s your optimization goal — maximize ROAS, conversions, or minimize CPA?' },
    }],
  }),
);

// ── Server startup ──────────────────────────────────────────────────

async function main() {
  const isHTTP = process.env.PORT || process.env.MCPIZE;

  if (isHTTP) {
    // Production: Streamable HTTP for MCPize deployment
    const port = parseInt(process.env.PORT ?? '8080', 10);

    const serverCard = {
      serverInfo: { name: 'adops-mcp', version: SERVER_VERSION },
      tools: [
        { name: 'platform_connect', description: 'Register ad platform connection' },
        { name: 'campaign_list', description: 'List campaigns across platforms' },
        { name: 'campaign_create', description: 'Create new campaign' },
        { name: 'campaign_update', description: 'Update campaign settings' },
        { name: 'campaign_pause_resume', description: 'Batch pause or resume campaigns' },
        { name: 'ads_report', description: 'Cross-platform performance report' },
        { name: 'budget_analyze', description: 'Budget analysis with AI recommendations' },
        { name: 'budget_reallocate', description: 'Transfer budget between campaigns' },
        { name: 'audience_insights', description: 'Audience demographic analysis' },
        { name: 'creative_specs', description: 'Platform creative requirements' },
        { name: 'anomaly_detect', description: 'Performance anomaly detection' },
        { name: 'ab_test_analyze', description: 'A/B test statistical analysis' },
        { name: 'competitor_benchmark', description: 'Industry benchmark comparison' },
        { name: 'forecast_spend', description: 'Spend and conversion forecasting' },
      ],
      resources: [
        { uri: 'ads://overview', description: 'Cross-platform dashboard' },
        { uri: 'ads://campaigns', description: 'Active campaigns' },
        { uri: 'ads://budget', description: 'Budget allocation' },
        { uri: 'ads://alerts', description: 'Performance alerts' },
      ],
    };

    const httpServer = createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', server: 'adops-mcp', version: SERVER_VERSION }));
        return;
      }

      if (req.method === 'GET' && req.url === '/.well-known/mcp/server-card.json') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(serverCard));
        return;
      }

      if ((req.method === 'POST' || req.method === 'GET' || req.method === 'DELETE') && req.url === '/mcp') {
        try {
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
          try { await server.close(); } catch { /* not connected yet */ }
          await server.connect(transport);
          await transport.handleRequest(req, res);
        } catch (err) {
          console.error('[AdOps MCP] Request error:', err);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        }
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    httpServer.listen(port, () => {
      console.error(`[AdOps MCP] v${SERVER_VERSION} running on HTTP port ${port} — ${TOOL_COUNT} tools, ${RESOURCE_COUNT} resources`);
    });
  } else {
    // Local development: stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`[AdOps MCP] v${SERVER_VERSION} running on stdio — ${TOOL_COUNT} tools, ${RESOURCE_COUNT} resources`);
  }
}

main().catch(console.error);
