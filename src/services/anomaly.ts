import { v4 as uuidv4 } from 'uuid';
import { storage as defaultStorage, Storage } from './storage.js';
import { calculateCTR, calculateCPC, calculateCPM } from './analytics.js';
import type { AnomalyAlert, Platform, AnomalySeverity } from '../models/adops.js';

interface MetricSummary {
  campaign_id: string;
  campaign_name: string;
  platform: Platform;
  recent: { cpc: number; ctr: number; spend: number; cpm: number; conversions: number };
  baseline: { cpc: number; ctr: number; spend: number; cpm: number; conversions: number };
}

/** Scan active campaigns for performance anomalies by comparing recent metrics against baseline. Detects CPC spikes, CTR drops, spend surges, and conversion declines with configurable sensitivity. */
export async function detectAnomalies(
  sensitivity: 'low' | 'medium' | 'high' = 'medium',
  lookbackDays: number = 7,
  platformFilter?: Platform,
  store?: Storage,
): Promise<AnomalyAlert[]> {
  const s = store ?? defaultStorage;
  const campaigns = await s.getAllCampaigns();
  const allMetrics = await s.getAllMetrics();

  const now = new Date();
  const recentStart = new Date(now.getTime() - lookbackDays * 86400000).toISOString().split('T')[0];
  const baselineEnd = recentStart;
  const baselineStart = new Date(now.getTime() - lookbackDays * 2 * 86400000).toISOString().split('T')[0];

  // Threshold multipliers based on sensitivity
  const threshold = sensitivity === 'low' ? 0.40 : sensitivity === 'medium' ? 0.25 : 0.15;

  const alerts: AnomalyAlert[] = [];

  const activeCampaigns = campaigns.filter((c) => {
    if (c.status !== 'active') return false;
    if (platformFilter && c.platform !== platformFilter) return false;
    return true;
  });

  for (const camp of activeCampaigns) {
    const recentMetrics = allMetrics.filter(
      (m) => m.campaign_id === camp.id && m.date >= recentStart,
    );
    const baselineMetrics = allMetrics.filter(
      (m) => m.campaign_id === camp.id && m.date >= baselineStart && m.date < baselineEnd,
    );

    if (recentMetrics.length === 0 || baselineMetrics.length === 0) continue;

    const recent = aggregateMetrics(recentMetrics);
    const baseline = aggregateMetrics(baselineMetrics);

    // Check each metric for anomalies
    const checks: { metric: string; recentVal: number; baselineVal: number; higherIsBad: boolean }[] = [
      { metric: 'cpc', recentVal: recent.cpc, baselineVal: baseline.cpc, higherIsBad: true },
      { metric: 'cpm', recentVal: recent.cpm, baselineVal: baseline.cpm, higherIsBad: true },
      { metric: 'ctr', recentVal: recent.ctr, baselineVal: baseline.ctr, higherIsBad: false },
      { metric: 'spend', recentVal: recent.spend, baselineVal: baseline.spend, higherIsBad: true },
      { metric: 'conversions', recentVal: recent.conversions, baselineVal: baseline.conversions, higherIsBad: false },
    ];

    for (const check of checks) {
      if (check.baselineVal === 0) continue;

      const deviation = (check.recentVal - check.baselineVal) / check.baselineVal;
      const isAnomaly = check.higherIsBad
        ? deviation > threshold
        : deviation < -threshold;

      if (!isAnomaly) continue;

      const absDeviation = Math.abs(deviation) * 100;
      const severity = determineSeverity(absDeviation);
      const { description, recommendation } = generateAlertText(
        check.metric, deviation, check.recentVal, check.baselineVal, camp.name, check.higherIsBad,
      );

      alerts.push({
        id: uuidv4(),
        campaign_id: camp.id,
        campaign_name: camp.name,
        platform: camp.platform,
        severity,
        metric: check.metric,
        expected_value: round(check.baselineVal),
        actual_value: round(check.recentVal),
        deviation_percent: round(absDeviation),
        detected_at: now.toISOString(),
        description,
        recommendation,
      });
    }
  }

  // Store alerts
  for (const alert of alerts) {
    await s.addAlert(alert);
  }

  return alerts.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}

function aggregateMetrics(metrics: { spend: number; clicks: number; impressions: number; conversions: number }[]): {
  cpc: number; ctr: number; spend: number; cpm: number; conversions: number;
} {
  const totalSpend = metrics.reduce((s, m) => s + m.spend, 0);
  const totalClicks = metrics.reduce((s, m) => s + m.clicks, 0);
  const totalImpressions = metrics.reduce((s, m) => s + m.impressions, 0);
  const totalConversions = metrics.reduce((s, m) => s + m.conversions, 0);

  return {
    cpc: calculateCPC(totalSpend, totalClicks),
    ctr: calculateCTR(totalClicks, totalImpressions),
    spend: totalSpend,
    cpm: calculateCPM(totalSpend, totalImpressions),
    conversions: totalConversions,
  };
}

function determineSeverity(deviationPercent: number): AnomalySeverity {
  if (deviationPercent >= 100) return 'critical';
  if (deviationPercent >= 50) return 'high';
  if (deviationPercent >= 30) return 'medium';
  return 'low';
}

function generateAlertText(
  metric: string, deviation: number, recentVal: number, baselineVal: number,
  campaignName: string, higherIsBad: boolean,
): { description: string; recommendation: string } {
  const direction = deviation > 0 ? 'increased' : 'decreased';
  const pct = Math.abs(Math.round(deviation * 100));
  const metricLabel = metric.toUpperCase();

  const description = `${metricLabel} ${direction} by ${pct}% for "${campaignName}" (${round(baselineVal)} → ${round(recentVal)}).`;

  let recommendation: string;
  if (metric === 'cpc' && deviation > 0) {
    recommendation = 'CPC spike detected. Check for increased competition, review keyword bids, or refresh ad creative to improve quality score.';
  } else if (metric === 'ctr' && deviation < 0) {
    recommendation = 'CTR is dropping. Your audience may be experiencing ad fatigue. Test new creative variants or narrow targeting.';
  } else if (metric === 'spend' && deviation > 0.5) {
    recommendation = 'Spending significantly above baseline. Verify budget settings and ensure no unexpected bid changes.';
  } else if (metric === 'conversions' && deviation < 0) {
    recommendation = 'Conversions declining. Check landing page performance, conversion tracking setup, and competitive landscape.';
  } else if (metric === 'cpm' && deviation > 0) {
    recommendation = 'CPM increased. Competition may be higher in your target audience. Consider adjusting targeting or placement.';
  } else {
    recommendation = `Monitor ${metricLabel} closely. If the trend continues, consider adjusting campaign settings.`;
  }

  return { description, recommendation };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
