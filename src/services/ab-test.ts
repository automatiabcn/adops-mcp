import { storage as defaultStorage, Storage } from './storage.js';
import { calculateCTR, calculateCPA, calculateROAS, calculateConversionRate } from './analytics.js';
import { NotFoundError } from '../utils/errors.js';
import type { ABTestResult } from '../models/adops.js';

/** Compare two campaign variants as an A/B test. Uses Z-test for proportions (CTR, conversion rate) and heuristic analysis for continuous metrics (CPA, ROAS). Reports statistical significance, winner, and recommendations. */
export async function analyzeABTest(
  campaignIdA: string,
  campaignIdB: string,
  primaryMetric: 'ctr' | 'cpa' | 'roas' | 'conversion_rate' = 'ctr',
  store?: Storage,
): Promise<ABTestResult> {
  const s = store ?? defaultStorage;

  const campA = await s.getCampaignById(campaignIdA);
  if (!campA) throw new NotFoundError('Campaign', campaignIdA);
  const campB = await s.getCampaignById(campaignIdB);
  if (!campB) throw new NotFoundError('Campaign', campaignIdB);

  const metricsA = await s.getMetricsByCampaign(campaignIdA);
  const metricsB = await s.getMetricsByCampaign(campaignIdB);

  const aggA = aggregate(metricsA);
  const aggB = aggregate(metricsB);

  const variantA = {
    name: campA.name,
    impressions: aggA.impressions,
    clicks: aggA.clicks,
    conversions: aggA.conversions,
    spend: round(aggA.spend),
    ctr: calculateCTR(aggA.clicks, aggA.impressions),
    cpa: calculateCPA(aggA.spend, aggA.conversions),
    roas: calculateROAS(aggA.revenue, aggA.spend),
  };

  const variantB = {
    name: campB.name,
    impressions: aggB.impressions,
    clicks: aggB.clicks,
    conversions: aggB.conversions,
    spend: round(aggB.spend),
    ctr: calculateCTR(aggB.clicks, aggB.impressions),
    cpa: calculateCPA(aggB.spend, aggB.conversions),
    roas: calculateROAS(aggB.revenue, aggB.spend),
  };

  // Statistical significance
  const confidence = calculateSignificance(
    { ...aggA, spend: aggA.spend, revenue: aggA.revenue },
    { ...aggB, spend: aggB.spend, revenue: aggB.revenue },
    primaryMetric,
  );

  // Determine winner
  const metricA = getMetricValue(variantA, primaryMetric);
  const metricB = getMetricValue(variantB, primaryMetric);
  const isLowerBetter = primaryMetric === 'cpa';

  let winner: 'a' | 'b' | 'no_winner';
  if (confidence < 90) {
    winner = 'no_winner';
  } else if (isLowerBetter) {
    winner = metricA < metricB ? 'a' : 'b';
  } else {
    winner = metricA > metricB ? 'a' : 'b';
  }

  const winnerVal = winner === 'a' ? metricA : winner === 'b' ? metricB : 0;
  const loserVal = winner === 'a' ? metricB : winner === 'b' ? metricA : 0;
  const liftPercent = loserVal > 0 ? round(((winnerVal - loserVal) / loserVal) * 100) : 0;

  // Sample size check (minimum 100 clicks per variant for meaningful results)
  const sampleSizeSufficient = aggA.clicks >= 100 && aggB.clicks >= 100;

  let recommendation: string;
  if (!sampleSizeSufficient) {
    recommendation = `Insufficient data. Variant A has ${aggA.clicks} clicks, Variant B has ${aggB.clicks}. Need at least 100 clicks per variant for reliable results. Continue running the test.`;
  } else if (winner === 'no_winner') {
    recommendation = `No statistically significant winner yet (${round(confidence)}% confidence). Continue running the test or increase budget to reach significance faster.`;
  } else {
    const winnerName = winner === 'a' ? campA.name : campB.name;
    recommendation = `"${winnerName}" is the winner with ${round(confidence)}% confidence and ${Math.abs(liftPercent)}% lift in ${primaryMetric.toUpperCase()}. Consider scaling the winner and pausing the loser.`;
  }

  return {
    test_name: `${campA.name} vs ${campB.name}`,
    variant_a: variantA,
    variant_b: variantB,
    winner,
    confidence_level: round(confidence),
    primary_metric: primaryMetric,
    lift_percent: liftPercent,
    recommendation,
    sample_size_sufficient: sampleSizeSufficient,
  };
}

function aggregate(metrics: { impressions: number; clicks: number; conversions: number; spend: number; conversion_value: number }[]) {
  return {
    impressions: metrics.reduce((s, m) => s + m.impressions, 0),
    clicks: metrics.reduce((s, m) => s + m.clicks, 0),
    conversions: metrics.reduce((s, m) => s + m.conversions, 0),
    spend: metrics.reduce((s, m) => s + m.spend, 0),
    revenue: metrics.reduce((s, m) => s + m.conversion_value, 0),
  };
}

function getMetricValue(variant: { ctr: number; cpa: number; roas: number; conversions: number; clicks: number }, metric: string): number {
  if (metric === 'ctr') return variant.ctr;
  if (metric === 'cpa') return variant.cpa;
  if (metric === 'roas') return variant.roas;
  if (metric === 'conversion_rate') return variant.clicks > 0 ? (variant.conversions / variant.clicks) * 100 : 0;
  return variant.ctr;
}

function calculateSignificance(
  a: { impressions: number; clicks: number; conversions: number; spend?: number; revenue?: number },
  b: { impressions: number; clicks: number; conversions: number; spend?: number; revenue?: number },
  metric: string,
): number {
  // For proportion-based metrics (CTR, conversion_rate): Z-test for proportions
  if (metric === 'ctr' || metric === 'conversion_rate') {
    let pA: number, pB: number, nA: number, nB: number;

    if (metric === 'ctr') {
      pA = a.impressions > 0 ? a.clicks / a.impressions : 0;
      pB = b.impressions > 0 ? b.clicks / b.impressions : 0;
      nA = a.impressions;
      nB = b.impressions;
    } else {
      pA = a.clicks > 0 ? a.conversions / a.clicks : 0;
      pB = b.clicks > 0 ? b.conversions / b.clicks : 0;
      nA = a.clicks;
      nB = b.clicks;
    }

    if (nA === 0 || nB === 0) return 0;
    const pooledP = (pA * nA + pB * nB) / (nA + nB);
    if (pooledP === 0 || pooledP === 1) return 0;
    const se = Math.sqrt(pooledP * (1 - pooledP) * (1 / nA + 1 / nB));
    if (se === 0) return 0;
    const z = Math.abs(pA - pB) / se;
    const confidence = normalCDF(z) * 2 - 1;
    return Math.min(99.9, confidence * 100);
  }

  // For continuous metrics (CPA, ROAS): use sample size heuristic
  // Without per-day granularity, approximate confidence from conversion counts
  const totalConversions = a.conversions + b.conversions;
  if (totalConversions < 10) return 0;

  // Larger sample = higher confidence, capped at 95%
  const sampleFactor = Math.min(totalConversions / 100, 1);
  const metricDiff = metric === 'cpa'
    ? Math.abs((a.spend ?? 0) / Math.max(a.conversions, 1) - (b.spend ?? 0) / Math.max(b.conversions, 1))
    : Math.abs((a.revenue ?? 0) / Math.max(a.spend ?? 1, 1) - (b.revenue ?? 0) / Math.max(b.spend ?? 1, 1));
  const avgMetric = metric === 'cpa'
    ? ((a.spend ?? 0) + (b.spend ?? 0)) / Math.max(a.conversions + b.conversions, 1)
    : ((a.revenue ?? 0) + (b.revenue ?? 0)) / Math.max((a.spend ?? 1) + (b.spend ?? 1), 1);

  if (avgMetric === 0) return 0;
  const effectSize = metricDiff / avgMetric;
  const confidence = Math.min(99.9, effectSize * sampleFactor * 200);
  return Math.max(0, confidence);
}

function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
