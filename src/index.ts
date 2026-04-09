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

const server = new McpServer({ name: 'adops-mcp', version: '1.0.0' });

// ── Tool 1: platform_connect ────────────────────────────────────────

server.registerTool(
  'platform_connect',
  {
    title: 'Connect Ad Platform',
    description: 'Register a Google Ads or Meta Ads account connection. Stores the connection for subsequent API calls.',
    inputSchema: PlatformConnectInputSchema,
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
    description: 'List and filter campaigns across all connected ad platforms. Supports filtering by platform, status, name search, and pagination.',
    inputSchema: CampaignListInputSchema,
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
    description: 'Create a new advertising campaign on Google Ads or Meta Ads. Translates unified parameters into platform-specific settings.',
    inputSchema: CampaignCreateInputSchema,
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
    description: 'Update campaign settings including name, budget, status, bidding strategy, and end date.',
    inputSchema: CampaignUpdateInputSchema,
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
    description: 'Batch pause or resume multiple campaigns at once. Supports up to 50 campaigns per call.',
    inputSchema: CampaignPauseResumeInputSchema,
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
    description: 'Generate a unified performance report across all connected ad platforms. Includes ROAS, CPC, CTR, conversions, and identifies top performers and underperformers.',
    inputSchema: AdsReportInputSchema,
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
    description: 'Analyze budget allocation across platforms and campaigns. Provides AI-powered recommendations to maximize ROAS, conversions, or minimize CPA.',
    inputSchema: BudgetAnalyzeInputSchema,
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
    description: 'Transfer daily budget from one campaign to another. Works across platforms.',
    inputSchema: BudgetReallocateInputSchema,
  },
  async ({ from_campaign_id, to_campaign_id, amount }) => {
    try {
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
    description: 'Get demographic and behavioral insights about your ad audience. Includes age, gender, location, interest, and device breakdowns.',
    inputSchema: AudienceInsightsInputSchema,
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
    description: 'Get platform-specific creative requirements for ad formats. Returns image sizes, video specs, text limits, and CTA options for Google and Meta ads.',
    inputSchema: CreativeSpecsInputSchema,
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
    description: 'Scan campaigns for performance anomalies: CPC spikes, CTR drops, unusual spend patterns. Uses statistical comparison against baseline.',
    inputSchema: AnomalyDetectInputSchema,
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
    description: 'Compare two campaigns as A/B test variants. Calculates statistical significance, determines winner, and provides recommendations.',
    inputSchema: ABTestAnalyzeInputSchema,
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
    description: 'Compare your ad performance against industry averages. Covers CTR, CPC, CPM, conversion rate, CPA, and ROAS with specific recommendations.',
    inputSchema: CompetitorBenchmarkInputSchema,
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
    description: 'Forecast ad spend, impressions, clicks, conversions, and ROAS for the next 7, 14, or 30 days based on historical trends.',
    inputSchema: ForecastSpendInputSchema,
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

// ── Server startup ──────────────────────────────────────────────────

async function main() {
  const isHTTP = process.env.PORT || process.env.MCPIZE;

  if (isHTTP) {
    // Production: Streamable HTTP for MCPize deployment
    const port = parseInt(process.env.PORT ?? '8080', 10);

    const httpServer = createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', version: '1.0.0' }));
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
      console.error(`[AdOps MCP] v1.0.0 running on HTTP port ${port} — 14 tools, 4 resources`);
    });
  } else {
    // Local development: stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[AdOps MCP] v1.0.0 running on stdio — 14 tools, 4 resources');
  }
}

main().catch(console.error);
