import { z } from 'zod';

// ── Platform ────────────────────────────────────────────────────────

export const PlatformSchema = z.enum(['google', 'meta']);
export type Platform = z.infer<typeof PlatformSchema>;

export const AllPlatforms: Platform[] = ['google', 'meta'];

// ── Platform Credentials ────────────────────────────────────────────

export const GoogleCredentialsSchema = z.object({
  developer_token: z.string().describe('Google Ads API developer token'),
  client_id: z.string().describe('OAuth2 client ID'),
  client_secret: z.string().describe('OAuth2 client secret'),
  refresh_token: z.string().describe('OAuth2 refresh token'),
  customer_id: z.string().describe('Google Ads customer ID (10 digits, no dashes)'),
  login_customer_id: z.string().optional().describe('MCC manager account ID'),
});

export const MetaCredentialsSchema = z.object({
  app_id: z.string().describe('Meta App ID'),
  app_secret: z.string().describe('Meta App Secret'),
  access_token: z.string().describe('Long-lived system user access token'),
  ad_account_id: z.string().describe('Ad account ID (act_XXXXXXXXX)'),
});

export const PlatformConnectionSchema = z.object({
  id: z.string().uuid(),
  platform: PlatformSchema,
  name: z.string().describe('Friendly connection name'),
  account_id: z.string().describe('Platform-specific account ID'),
  connected_at: z.string(),
  last_sync_at: z.string().nullable(),
  status: z.enum(['active', 'expired', 'error']),
});
export type PlatformConnection = z.infer<typeof PlatformConnectionSchema>;

// ── Unified Campaign ────────────────────────────────────────────────

export const CampaignStatusSchema = z.enum(['active', 'paused', 'completed', 'draft', 'removed']);
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;

export const CampaignObjectiveSchema = z.enum([
  'awareness', 'reach', 'traffic', 'engagement',
  'leads', 'conversions', 'sales', 'app_installs', 'video_views', 'other',
]);
export type CampaignObjective = z.infer<typeof CampaignObjectiveSchema>;

export const BiddingStrategySchema = z.enum([
  'manual_cpc', 'target_cpa', 'target_roas', 'maximize_conversions',
  'maximize_clicks', 'maximize_conversion_value', 'lowest_cost', 'cost_cap',
]);

export const UnifiedCampaignSchema = z.object({
  id: z.string().uuid().describe('Internal AdOps unique ID'),
  platform: PlatformSchema,
  platform_campaign_id: z.string().describe('Original platform ID'),
  connection_id: z.string().uuid().describe('Platform connection ID'),
  name: z.string(),
  status: CampaignStatusSchema,
  objective: CampaignObjectiveSchema,
  bidding_strategy: BiddingStrategySchema.nullable(),
  daily_budget: z.number().min(0).describe('Daily budget in account currency'),
  total_budget: z.number().min(0).nullable().describe('Lifetime budget'),
  currency: z.string().length(3).describe('ISO 4217 currency code'),
  start_date: z.string(),
  end_date: z.string().nullable(),
  targeting: z.object({
    geo: z.array(z.string()).describe('ISO 3166-1 alpha-2 country codes'),
    age_min: z.number().int().min(13).nullable(),
    age_max: z.number().int().max(100).nullable(),
    gender: z.enum(['all', 'male', 'female']).nullable(),
    interests: z.array(z.string()),
    devices: z.array(z.enum(['mobile', 'desktop', 'tablet'])),
  }),
  created_at: z.string(),
  updated_at: z.string(),
  synced_at: z.string().nullable(),
});
export type UnifiedCampaign = z.infer<typeof UnifiedCampaignSchema>;

// ── Unified Metrics ─────────────────────────────────────────────────

export const UnifiedMetricsSchema = z.object({
  campaign_id: z.string().uuid(),
  platform: PlatformSchema,
  date: z.string().describe('YYYY-MM-DD'),
  impressions: z.number().int().min(0),
  clicks: z.number().int().min(0),
  spend: z.number().min(0).describe('Spend in account currency'),
  conversions: z.number().min(0),
  conversion_value: z.number().min(0).describe('Revenue from conversions'),

  // Calculated metrics
  ctr: z.number().min(0).describe('Click-through rate (%)'),
  cpc: z.number().min(0).describe('Cost per click'),
  cpm: z.number().min(0).describe('Cost per 1000 impressions'),
  roas: z.number().min(0).describe('Return on ad spend'),
  cpa: z.number().min(0).describe('Cost per acquisition'),
  conversion_rate: z.number().min(0).describe('Conversion rate (%)'),

  // Platform-specific extras
  reach: z.number().int().min(0).nullable().describe('Meta: unique users reached'),
  frequency: z.number().min(0).nullable().describe('Meta: avg times shown per user'),
  quality_score: z.number().int().min(1).max(10).nullable().describe('Google: keyword quality score'),
  video_views: z.number().int().min(0).nullable(),
});
export type UnifiedMetrics = z.infer<typeof UnifiedMetricsSchema>;

// ── Performance Report ──────────────────────────────────────────────

export const PerformanceReportSchema = z.object({
  report_id: z.string().uuid(),
  generated_at: z.string(),
  date_range: z.object({
    start: z.string(),
    end: z.string(),
  }),
  platforms: z.array(PlatformSchema),
  summary: z.object({
    total_spend: z.number(),
    total_impressions: z.number(),
    total_clicks: z.number(),
    total_conversions: z.number(),
    total_revenue: z.number(),
    blended_ctr: z.number(),
    blended_cpc: z.number(),
    blended_cpm: z.number(),
    blended_roas: z.number(),
    blended_cpa: z.number(),
  }),
  by_platform: z.array(z.object({
    platform: PlatformSchema,
    spend: z.number(),
    impressions: z.number(),
    clicks: z.number(),
    conversions: z.number(),
    revenue: z.number(),
    ctr: z.number(),
    cpc: z.number(),
    roas: z.number(),
    cpa: z.number(),
  })),
  by_campaign: z.array(z.object({
    campaign_id: z.string().uuid(),
    campaign_name: z.string(),
    platform: PlatformSchema,
    spend: z.number(),
    impressions: z.number(),
    clicks: z.number(),
    conversions: z.number(),
    revenue: z.number(),
    roas: z.number(),
    cpa: z.number(),
    status: CampaignStatusSchema,
  })),
  top_performers: z.array(z.object({
    campaign_name: z.string(),
    platform: PlatformSchema,
    roas: z.number(),
    spend: z.number(),
  })),
  underperformers: z.array(z.object({
    campaign_name: z.string(),
    platform: PlatformSchema,
    roas: z.number(),
    spend: z.number(),
    recommendation: z.string(),
  })),
});
export type PerformanceReport = z.infer<typeof PerformanceReportSchema>;

// ── Budget Analysis ─────────────────────────────────────────────────

export const BudgetAnalysisSchema = z.object({
  total_daily_budget: z.number(),
  total_spend_today: z.number(),
  utilization_rate: z.number().describe('% of budget spent'),
  by_platform: z.array(z.object({
    platform: PlatformSchema,
    daily_budget: z.number(),
    spend_today: z.number(),
    utilization: z.number(),
    roas: z.number(),
    campaigns_count: z.number(),
  })),
  recommendations: z.array(z.object({
    type: z.enum(['increase', 'decrease', 'reallocate', 'pause']),
    campaign_name: z.string(),
    platform: PlatformSchema,
    current_budget: z.number(),
    suggested_budget: z.number(),
    reason: z.string(),
    expected_impact: z.string(),
  })),
});
export type BudgetAnalysis = z.infer<typeof BudgetAnalysisSchema>;

// ── Anomaly Alert ───────────────────────────────────────────────────

export const AnomalySeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type AnomalySeverity = z.infer<typeof AnomalySeveritySchema>;

export const AnomalyAlertSchema = z.object({
  id: z.string().uuid(),
  campaign_id: z.string().uuid(),
  campaign_name: z.string(),
  platform: PlatformSchema,
  severity: AnomalySeveritySchema,
  metric: z.string().describe('Affected metric (cpc, ctr, spend, etc.)'),
  expected_value: z.number(),
  actual_value: z.number(),
  deviation_percent: z.number().describe('% deviation from expected'),
  detected_at: z.string(),
  description: z.string(),
  recommendation: z.string(),
});
export type AnomalyAlert = z.infer<typeof AnomalyAlertSchema>;

// ── A/B Test Result ─────────────────────────────────────────────────

export const ABTestResultSchema = z.object({
  test_name: z.string(),
  variant_a: z.object({
    name: z.string(),
    impressions: z.number(),
    clicks: z.number(),
    conversions: z.number(),
    spend: z.number(),
    ctr: z.number(),
    cpa: z.number(),
    roas: z.number(),
  }),
  variant_b: z.object({
    name: z.string(),
    impressions: z.number(),
    clicks: z.number(),
    conversions: z.number(),
    spend: z.number(),
    ctr: z.number(),
    cpa: z.number(),
    roas: z.number(),
  }),
  winner: z.enum(['a', 'b', 'no_winner']),
  confidence_level: z.number().min(0).max(100).describe('Statistical significance (%)'),
  primary_metric: z.string(),
  lift_percent: z.number().describe('% improvement of winner over loser'),
  recommendation: z.string(),
  sample_size_sufficient: z.boolean(),
});
export type ABTestResult = z.infer<typeof ABTestResultSchema>;

// ── Audience Insight ────────────────────────────────────────────────

export const AudienceInsightSchema = z.object({
  platform: PlatformSchema,
  campaign_id: z.string().uuid().nullable(),
  total_reach: z.number(),
  demographics: z.object({
    age_groups: z.array(z.object({
      range: z.string(),
      percentage: z.number(),
      impressions: z.number(),
      ctr: z.number(),
    })),
    gender: z.array(z.object({
      gender: z.string(),
      percentage: z.number(),
      impressions: z.number(),
      ctr: z.number(),
    })),
    top_locations: z.array(z.object({
      location: z.string(),
      percentage: z.number(),
      impressions: z.number(),
    })),
  }),
  top_interests: z.array(z.object({
    interest: z.string(),
    affinity_score: z.number(),
  })),
  device_breakdown: z.array(z.object({
    device: z.string(),
    percentage: z.number(),
    ctr: z.number(),
    cpc: z.number(),
  })),
});
export type AudienceInsight = z.infer<typeof AudienceInsightSchema>;

// ── Spend Forecast ──────────────────────────────────────────────────

export const SpendForecastSchema = z.object({
  forecast_period_days: z.number().int(),
  date_range: z.object({ start: z.string(), end: z.string() }),
  projected_spend: z.number(),
  projected_impressions: z.number(),
  projected_clicks: z.number(),
  projected_conversions: z.number(),
  projected_revenue: z.number(),
  projected_roas: z.number(),
  confidence_interval: z.object({
    low: z.number(),
    high: z.number(),
  }),
  by_platform: z.array(z.object({
    platform: PlatformSchema,
    projected_spend: z.number(),
    projected_conversions: z.number(),
    projected_roas: z.number(),
  })),
  assumptions: z.array(z.string()),
});
export type SpendForecast = z.infer<typeof SpendForecastSchema>;

// ── Creative Specs ──────────────────────────────────────────────────

export const CreativeSpecSchema = z.object({
  platform: PlatformSchema,
  format: z.string(),
  placement: z.string(),
  image_specs: z.object({
    width: z.number().int(),
    height: z.number().int(),
    aspect_ratio: z.string(),
    max_file_size_mb: z.number(),
    formats: z.array(z.string()),
  }).nullable(),
  video_specs: z.object({
    min_duration_sec: z.number(),
    max_duration_sec: z.number(),
    aspect_ratios: z.array(z.string()),
    max_file_size_mb: z.number(),
    formats: z.array(z.string()),
  }).nullable(),
  text_specs: z.object({
    headline_max_chars: z.number().int(),
    description_max_chars: z.number().int(),
    cta_options: z.array(z.string()),
  }),
});
export type CreativeSpec = z.infer<typeof CreativeSpecSchema>;

// ── Competitor Benchmark ────────────────────────────────────────────

export const CompetitorBenchmarkSchema = z.object({
  industry: z.string(),
  benchmarks: z.object({
    avg_ctr: z.number(),
    avg_cpc: z.number(),
    avg_cpm: z.number(),
    avg_conversion_rate: z.number(),
    avg_cpa: z.number(),
    avg_roas: z.number(),
  }),
  your_performance: z.object({
    ctr: z.number(),
    cpc: z.number(),
    cpm: z.number(),
    conversion_rate: z.number(),
    cpa: z.number(),
    roas: z.number(),
  }),
  comparison: z.array(z.object({
    metric: z.string(),
    your_value: z.number(),
    industry_avg: z.number(),
    difference_percent: z.number(),
    rating: z.enum(['above_average', 'average', 'below_average']),
  })),
  recommendations: z.array(z.string()),
});
export type CompetitorBenchmark = z.infer<typeof CompetitorBenchmarkSchema>;

// ── Tool Input Schemas ──────────────────────────────────────────────

export const PlatformConnectInputSchema = z.object({
  platform: PlatformSchema.describe('Ad platform to connect'),
  name: z.string().min(1).max(100).describe('Friendly connection name'),
  account_id: z.string().min(1).describe('Platform-specific ad account ID (Google: 10 digits, Meta: act_XXXXXXXXX)'),
}).refine(
  (data) => {
    if (data.platform === 'google') return /^\d{10}$/.test(data.account_id.replace(/-/g, ''));
    if (data.platform === 'meta') return /^act_\d+$/.test(data.account_id);
    return true;
  },
  { message: 'Invalid account ID format. Google: 10 digits (no dashes). Meta: act_XXXXXXXXX.' },
);

export const CampaignListInputSchema = z.object({
  platform: PlatformSchema.optional().describe('Filter by platform'),
  status: CampaignStatusSchema.optional().describe('Filter by status'),
  query: z.string().optional().describe('Search campaign names'),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export const CampaignCreateInputSchema = z.object({
  platform: PlatformSchema.describe('Target platform'),
  name: z.string().min(1).max(150).describe('Campaign name'),
  objective: CampaignObjectiveSchema.describe('Campaign objective'),
  daily_budget: z.number().min(1).describe('Daily budget'),
  currency: z.string().length(3).default('USD').describe('ISO 4217 currency'),
  start_date: z.string().optional().describe('ISO date (defaults to today)'),
  end_date: z.string().optional().describe('ISO date (optional)'),
  bidding_strategy: BiddingStrategySchema.optional().describe('Bidding strategy'),
  targeting: z.object({
    geo: z.array(z.string()).optional().describe('Country codes'),
    age_min: z.number().int().min(13).optional(),
    age_max: z.number().int().max(100).optional(),
    gender: z.enum(['all', 'male', 'female']).optional(),
    interests: z.array(z.string()).optional(),
    devices: z.array(z.enum(['mobile', 'desktop', 'tablet'])).optional(),
  }).refine(
    (t) => !t.age_min || !t.age_max || t.age_min <= t.age_max,
    { message: 'age_min must be less than or equal to age_max' },
  ).optional(),
});

export const CampaignUpdateInputSchema = z.object({
  campaign_id: z.string().uuid().describe('AdOps campaign ID'),
  name: z.string().min(1).max(150).optional(),
  daily_budget: z.number().min(0).optional(),
  total_budget: z.number().min(0).optional().nullable(),
  status: CampaignStatusSchema.optional(),
  bidding_strategy: BiddingStrategySchema.optional(),
  end_date: z.string().optional().nullable(),
});

export const CampaignPauseResumeInputSchema = z.object({
  campaign_ids: z.array(z.string().uuid()).min(1).max(50).describe('Campaign IDs to toggle'),
  action: z.enum(['pause', 'resume']).describe('Action to perform'),
});

export const AdsReportInputSchema = z.object({
  platform: PlatformSchema.optional().describe('Filter by platform'),
  date_range: z.object({
    start: z.string().describe('Start date (YYYY-MM-DD)'),
    end: z.string().describe('End date (YYYY-MM-DD)'),
  }).optional().describe('Defaults to last 7 days'),
  campaign_ids: z.array(z.string().uuid()).optional().describe('Filter specific campaigns'),
  sort_by: z.enum(['spend', 'roas', 'conversions', 'clicks', 'ctr']).default('spend'),
  limit: z.number().int().min(1).max(100).default(20),
});

export const BudgetAnalyzeInputSchema = z.object({
  platform: PlatformSchema.optional().describe('Filter by platform'),
  optimization_goal: z.enum(['maximize_roas', 'maximize_conversions', 'minimize_cpa']).default('maximize_roas'),
});

export const BudgetReallocateInputSchema = z.object({
  from_campaign_id: z.string().uuid().describe('Source campaign'),
  to_campaign_id: z.string().uuid().describe('Destination campaign'),
  amount: z.number().min(1).describe('Amount to transfer'),
});

export const AudienceInsightsInputSchema = z.object({
  platform: PlatformSchema.describe('Platform to analyze'),
  campaign_id: z.string().uuid().optional().describe('Specific campaign (optional)'),
});

export const CreativeSpecsInputSchema = z.object({
  platform: PlatformSchema.describe('Platform to get specs for'),
  format: z.enum(['image', 'video', 'carousel', 'stories']).optional(),
});

export const AnomalyDetectInputSchema = z.object({
  platform: PlatformSchema.optional().describe('Filter by platform'),
  sensitivity: z.enum(['low', 'medium', 'high']).default('medium').describe('Detection sensitivity'),
  lookback_days: z.number().int().min(3).max(90).default(7),
});

export const ABTestAnalyzeInputSchema = z.object({
  campaign_id_a: z.string().uuid().describe('Variant A campaign'),
  campaign_id_b: z.string().uuid().describe('Variant B campaign'),
  primary_metric: z.enum(['ctr', 'cpa', 'roas', 'conversion_rate']).default('ctr'),
});

export const CompetitorBenchmarkInputSchema = z.object({
  industry: z.string().describe('Industry for benchmarking (e.g., "ecommerce", "saas", "finance")'),
  platform: PlatformSchema.optional(),
});

export const ForecastSpendInputSchema = z.object({
  period_days: z.enum(['7', '14', '30']).default('14').describe('Forecast period'),
  platform: PlatformSchema.optional(),
});
