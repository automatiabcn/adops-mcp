# AdOps MCP

**CSV-first analytics & optimization for Google Ads + Meta Ads — inside Claude, Cursor, and any MCP client.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-1.29-2A9D8F.svg)](https://modelcontextprotocol.io/)

Export a CSV from Google Ads or Meta Ads Manager → import into AdOps → ask your AI assistant anything about your campaigns.

No OAuth. No developer tokens. No API approval queues. Your data stays on your machine.

---

## Why CSV-first?

Google Ads API and Meta Marketing API are powerful but gated: developer token approval takes days, Meta app review takes weeks, OAuth flows are fragile. For most advertisers those barriers never clear.

AdOps takes a different path. Every ad platform's dashboard already has a **Download** / **Export** button that produces a CSV of exactly what you care about: campaign performance, day-segmented metrics, spend, conversions, ROAS. AdOps reads that CSV and runs the same analysis you'd get from a $200/mo optimization suite — anomaly detection, budget allocation, A/B significance, forecasting, industry benchmarks — directly inside your AI assistant.

You stay in control of your data. You don't hand credentials to a third party. You don't wait 3 weeks for a review.

---

## Features

- **17 MCP tools** covering the full ad analytics lifecycle
- **4 MCP resources** for at-a-glance dashboards
- **CSV import** from Google Ads Editor, Google Ads web UI, and Meta Ads Manager — with automatic format detection (US vs European number formatting, CRLF vs LF, BOM handling)
- **Unified cross-platform schema** — Google and Meta campaigns normalized into a single `UnifiedCampaign` / `UnifiedMetrics` model
- **AI-powered recommendations** — budget reallocation, scaling high-ROAS campaigns, pausing zero-conversion ones
- **Bulk-edit CSV export** — turn recommendations into Google Ads Editor / Meta Ads Manager CSVs you can paste straight into the dashboard for one-click bulk updates
- **Statistical anomaly detection** — CPC spikes, CTR drops, spend surges, sensitivity-configurable
- **A/B test analysis** with confidence scoring
- **9-vertical industry benchmarks** built-in (eCommerce, SaaS, B2B, etc.)
- **Spend & conversion forecasting** (7/14/30 days)
- **Demo mode** — seed a realistic portfolio to try the tools before importing your own data
- **91 automated tests** — TypeScript strict mode, Zod validation throughout

---

## Quick Start

```bash
npm i adops-mcp-server
```

Add to your MCP client (Claude Desktop `claude_desktop_config.json`, Cursor, VS Code, Windsurf):

```json
{
  "mcpServers": {
    "adops": {
      "command": "node",
      "args": ["path/to/node_modules/adops-mcp-server/dist/index.js"]
    }
  }
}
```

Restart your client. Then, inside Claude:

```
> Seed demo data so I can explore AdOps
```
(calls `ad_demo_seed`)

Or import your real data:

```
> Import ~/Downloads/google-ads-report.csv as a Google Ads CSV
```
(calls `ad_csv_import` with platform=google, csv_path=...)

---

## Exporting CSV from Your Ad Dashboard

### Google Ads

1. Open [ads.google.com](https://ads.google.com) → **Campaigns** view
2. (Optional) Click **Segment → Day** in the toolbar for daily metrics
3. Click **Download** (⬇) icon → choose **.csv** format
4. Save to disk, give the absolute path to `ad_csv_import`

### Meta Ads Manager

1. Open [business.facebook.com](https://business.facebook.com) → **Ads Manager**
2. Switch to **Campaigns** tab (not Ad Sets or Ads — campaign-level rollups)
3. (Optional) **Breakdown → Time → Day** for daily metrics
4. Click **Reports → Export → Campaign performance (.csv)**
5. Save to disk, give the absolute path to `ad_csv_import`

Both exports work out-of-the-box with or without day segmentation. Without a Day column, you get one aggregated metric row per campaign. With Day segmentation, you get daily time-series data — which powers forecasting and anomaly detection properly.

---

## Tools

| Tool | Description |
|------|-------------|
| `ad_demo_seed` | Seed a realistic cross-platform demo portfolio (8 campaigns, 30 days of metrics) to try AdOps before importing real data |
| `ad_csv_import` | **Import a Google Ads or Meta Ads CSV export** — every other tool operates on this data |
| `ads_export_recommendations` | **Export budget_analyze recommendations** as Google Ads Editor CSV, Meta Ads Manager CSV, JSON, or Markdown — one bulk-paste and your ad dashboard reflects the AI's plan |
| `platform_connect` | Register a data source connection manually (alternative to CSV import, for scripted workflows) |
| `campaign_list` | List and filter campaigns across all imported platforms |
| `campaign_create` | Add a campaign manually (useful for what-if planning) |
| `campaign_update` | Update campaign settings in local storage (budget, status, bidding, schedule) |
| `campaign_pause_resume` | Batch pause or resume up to 50 campaigns |
| `ads_report` | Generate unified cross-platform performance report |
| `budget_analyze` | Analyze budget allocation, produce scaling/pausing recommendations |
| `budget_reallocate` | Transfer budget between campaigns across platforms |
| `audience_insights` | Demographic / geographic / device breakdowns |
| `creative_specs` | Platform-specific image, video, and text requirements reference |
| `anomaly_detect` | Detect performance anomalies with configurable sensitivity |
| `ab_test_analyze` | Compare two campaigns with statistical significance testing |
| `competitor_benchmark` | Compare your metrics against industry averages (9 verticals) |
| `forecast_spend` | Forecast spend, conversions, ROAS for the next 7/14/30 days |

---

## Resources

| Resource | Description |
|----------|-------------|
| `ads://overview` | Cross-platform dashboard summary |
| `ads://campaigns` | All active campaigns with key metrics |
| `ads://budget` | Budget allocation across platforms |
| `ads://alerts` | Recent performance anomalies and warnings |

---

## Unified Metrics Schema

AdOps normalizes metrics across platforms:

| Metric | Formula | Notes |
|--------|---------|-------|
| CTR | clicks / impressions × 100 | Click-through rate (%) |
| CPC | spend / clicks | Cost per click |
| CPM | spend / impressions × 1000 | Cost per 1000 impressions |
| ROAS | conversion_value / spend | Return on ad spend |
| CPA | spend / conversions | Cost per acquisition |
| Conversion Rate | conversions / clicks × 100 | % |

**CSV column mapping:**

| AdOps Field | Google Ads CSV | Meta Ads CSV |
|-------------|---------------|--------------|
| `spend` | `Cost` (USD equivalent auto-converted if micros) | `Amount spent (USD/EUR/...)` |
| `impressions` | `Impressions` | `Impressions` |
| `clicks` | `Clicks` | `Link clicks` |
| `conversions` | `Conversions` | `Results` (Purchases/Leads/etc.) |
| `conversion_value` | `Conv. value` | `Purchases conversion value` |
| `reach` | — | `Reach` (Meta-only) |
| `quality_score` | `Quality Score` (if present) | — (Google-only) |

European locale numbers (`125,50` = 125.50) and semicolon-delimited CSVs are auto-detected.

---

## Configuration

AdOps is stateless from the network's point of view — no API keys, no OAuth. The only configuration is where it persists imported data:

| Variable | Description | Default |
|----------|-------------|---------|
| `ADOPS_DATA_DIR` | Directory for JSON persistence | `./data` |

All other behavior is controlled via tool arguments.

---

## Pricing

| Tier | Price | Features |
|------|-------|----------|
| Free | $0 | 1 imported CSV per day, demo mode, all 17 tools read-only |
| Pro | $24/mo | Unlimited imports, full CRUD, all analytics tools |
| Agency | $59/mo | Multi-account, white-label reports, priority support |

Available via [GitHub](https://github.com/enzoemir1/adops-mcp) (self-hosted, free) or the MCPize marketplace (managed).

---

## Development

```bash
git clone https://github.com/enzoemir1/adops-mcp.git
cd adops-mcp
npm ci
npm run build
npm test           # 91 tests across 10 suites
npm run inspect    # Open MCP Inspector
```

### Tests

91 tests covering:

- **CSV parser** (11 tests): RFC 4180 quoting, BOM, European/US number formats, delimiter detection
- **Google Ads CSV import** (7 tests): campaigns report, day segmentation, objective mapping, European locale
- **Meta Ads CSV import** (5 tests): Meta-specific columns, currency detection from header, objective mapping, reach/frequency capture
- **Export recommendations** (8 tests): Google Ads Editor CSV format, Meta Ads Manager CSV format, JSON wrapper, Markdown rendering, min_delta_pct filter, limit, by_type summary
- **Storage**: Connection CRUD, campaign search, metrics aggregation, batch inserts
- **Analytics**: Metric calculations, performance reports, forecasting, benchmarks
- **Optimizer**: Budget analysis, reallocation, scaling/pausing recommendations
- **Anomaly**: CPC spike detection, conversion drops, sensitivity, severity sorting
- **E2E Workflow**: 14 real user scenarios

---

## Roadmap

- **v1.3** — Add Google Ads Editor `.csv.gz` and Excel `.xlsx` support
- **v1.4** — Live Google Ads / Meta Ads API integration as an optional enterprise feature (BYOK — bring your own developer token + app review)
- **v2.0** — Multi-user server mode with JWT auth for team deployments

---

## Pro License

AdOps ships in **Free mode** — `ad_demo_seed`, `ad_csv_import`, `platform_connect`, `campaign_list`, `campaign_create`, `campaign_update`, `campaign_pause_resume`, `ads_report`, `budget_reallocate`, `audience_insights`, and `creative_specs` are open. The following tools require a **Pro license**:

- `ads_export_recommendations` — bulk-edit CSV export for Google Ads Editor / Meta Ads Manager
- `budget_analyze` — AI budget allocation analysis with action recommendations
- `anomaly_detect` — statistical anomaly detection
- `ab_test_analyze` — A/B test z-test with significance + uplift
- `forecast_spend` — 7/14/30-day spend & ROAS forecast
- `competitor_benchmark` — industry benchmark comparison

**Buy a Pro License (€24, lifetime, 3 machines):** https://automatiabcn.lemonsqueezy.com/buy/1525c929-832c-4472-a88a-58edbfa4e87b

Or get the **[Indie MCP Stack Bundle](https://automatiabcn.lemonsqueezy.com/buy/55e932fd-8319-47f0-8e95-0b86a29f2617)** (€69, all 4 servers).

```bash
export LEMONSQUEEZY_LICENSE_KEY=YOUR-KEY-HERE
```

Or in your MCP client config:

```json
{
  "mcpServers": {
    "adops-mcp": {
      "command": "npx",
      "args": ["-y", "adops-mcp-server"],
      "env": { "LEMONSQUEEZY_LICENSE_KEY": "YOUR-KEY-HERE" }
    }
  }
}
```

Validation is cached locally for 24 h — fully offline-capable after first run.

---

## License

MIT License. See [LICENSE](LICENSE) for details.

Built by [Automatia BCN](https://github.com/enzoemir1).
