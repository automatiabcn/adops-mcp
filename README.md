# AdOps MCP

**AI-powered cross-platform ad management for the Model Context Protocol**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-1.29-2A9D8F.svg)](https://modelcontextprotocol.io/)

Manage Google Ads and Meta Ads campaigns, analyze cross-platform performance, optimize budgets, and detect anomalies — all through AI assistants like Claude, Cursor, and VS Code.

---

## Features

- Unified campaign management for Google Ads and Meta Ads
- 14 MCP tools covering the full advertising lifecycle
- 4 MCP resources for quick dashboard access
- Cross-platform performance reporting with normalized metrics
- AI-powered budget optimization with actionable recommendations
- Statistical anomaly detection (CPC spikes, CTR drops, spend surges)
- A/B test analysis with confidence scoring
- Industry benchmark comparison (9 verticals)
- Spend and conversion forecasting (7/14/30 days)
- Platform-specific creative specs reference
- 42 automated tests (unit + E2E user workflows), TypeScript strict mode, Zod validation

---

## Quick Start

### Install from npm

```bash
npm i adops-mcp-server
```

### Add to your MCP client

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

### Build from source

```bash
git clone https://github.com/enzoemir1/adops-mcp.git
cd adops-mcp
npm ci && npm run build
```

---

## Tools

| Tool | Description |
|------|-------------|
| `platform_connect` | Register a Google Ads or Meta Ads account connection |
| `campaign_list` | List and filter campaigns across all connected platforms |
| `campaign_create` | Create a new campaign with unified parameters |
| `campaign_update` | Update campaign settings (budget, status, bidding, schedule) |
| `campaign_pause_resume` | Batch pause or resume up to 50 campaigns at once |
| `ads_report` | Generate unified cross-platform performance report |
| `budget_analyze` | Analyze budget allocation with optimization recommendations |
| `budget_reallocate` | Transfer budget between campaigns across platforms |
| `audience_insights` | Get demographic, geographic, and device breakdowns |
| `creative_specs` | Get platform-specific image, video, and text requirements |
| `anomaly_detect` | Detect performance anomalies with configurable sensitivity |
| `ab_test_analyze` | Compare two campaigns with statistical significance testing |
| `competitor_benchmark` | Compare your metrics against industry averages |
| `forecast_spend` | Forecast spend, conversions, and ROAS for the next period |

---

## Resources

| Resource | Description |
|----------|-------------|
| `ads://overview` | Cross-platform dashboard summary |
| `ads://campaigns` | All active campaigns with key metrics |
| `ads://budget` | Budget allocation across platforms |
| `ads://alerts` | Recent performance anomalies and warnings |

---

## Configuration

All integrations are optional. The server works without API keys using local storage for campaign management and analytics.

| Variable | Platform | Required | Description |
|----------|----------|----------|-------------|
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google | For live sync | API developer token |
| `GOOGLE_ADS_CLIENT_ID` | Google | For live sync | OAuth2 client ID |
| `GOOGLE_ADS_CLIENT_SECRET` | Google | For live sync | OAuth2 client secret |
| `GOOGLE_ADS_REFRESH_TOKEN` | Google | For live sync | OAuth2 refresh token |
| `GOOGLE_ADS_CUSTOMER_ID` | Google | For live sync | Ad account ID (10 digits) |
| `META_APP_ID` | Meta | For live sync | Facebook App ID |
| `META_APP_SECRET` | Meta | For live sync | Facebook App Secret |
| `META_ACCESS_TOKEN` | Meta | For live sync | System user access token |
| `META_AD_ACCOUNT_ID` | Meta | For live sync | Ad account ID (act_XXX) |

See `.env.example` for a complete template.

---

## Unified Metrics

AdOps normalizes metrics across platforms into a single schema:

| Metric | Formula | Description |
|--------|---------|-------------|
| CTR | clicks / impressions x 100 | Click-through rate (%) |
| CPC | spend / clicks | Cost per click |
| CPM | spend / impressions x 1000 | Cost per 1000 impressions |
| ROAS | revenue / spend | Return on ad spend |
| CPA | spend / conversions | Cost per acquisition |
| Conversion Rate | conversions / clicks x 100 | Conversion rate (%) |

**Platform field mapping:**

| AdOps Field | Google Ads | Meta Ads |
|-------------|-----------|----------|
| `spend` | `cost_micros / 1,000,000` | `amount_spent` |
| `impressions` | `impressions` | `impressions` |
| `clicks` | `clicks` | `clicks` |
| `conversions` | `conversions` | `actions[type=purchase]` |
| Campaign > Ad Group | Ad Group | Ad Set |

---

## Pricing

| Tier | Price | Features |
|------|-------|----------|
| Free | $0 | 1 platform, read-only reports, creative specs, 50 calls/day |
| Pro | $29/mo | 2 platforms, full CRUD, anomaly detection, budget optimization |
| Agency | $59/mo | Unlimited, forecasting, benchmarking, priority support |

Available on [MCPize](https://mcpize.com).

---

## Development

```bash
npm run dev        # Hot reload development
npm run build      # Production build
npm test           # Run 42 tests (unit + E2E)
npm run inspect    # Open MCP Inspector
```

---

## Testing

42 tests across 5 test suites:

- **Storage**: Connection CRUD, campaign search, metrics aggregation, batch inserts
- **Analytics**: Metric calculations, performance reports, forecasting, benchmarks
- **Optimizer**: Budget analysis, reallocation, scaling/pausing recommendations
- **Anomaly**: CPC spike detection, conversion drops, sensitivity levels, severity sorting
- **E2E Workflow**: 14 real user scenarios — connect platforms, create campaigns, generate reports, optimize budgets, run A/B tests, detect anomalies, forecast spend, benchmark vs industry

```bash
npm test
```

---

## License

MIT License. See [LICENSE](LICENSE) for details.

Built by [Automatia BCN](https://github.com/enzoemir1).
