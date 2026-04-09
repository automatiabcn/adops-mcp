import { storage as defaultStorage, Storage } from './storage.js';
import { calculateROAS, calculateCPA } from './analytics.js';
import type { BudgetAnalysis, Platform } from '../models/adops.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';

export async function analyzeBudget(
  optimizationGoal: 'maximize_roas' | 'maximize_conversions' | 'minimize_cpa' = 'maximize_roas',
  platformFilter?: Platform,
  store?: Storage,
): Promise<BudgetAnalysis> {
  const s = store ?? defaultStorage;
  const campaigns = await s.getAllCampaigns();
  const metrics = await s.getAllMetrics();

  const activeCampaigns = campaigns.filter((c) => {
    if (c.status !== 'active') return false;
    if (platformFilter && c.platform !== platformFilter) return false;
    return true;
  });

  // Aggregate metrics per campaign (last 7 days)
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
  const recentMetrics = metrics.filter((m) => m.date >= weekAgo);

  const campaignPerf: Record<string, { spend: number; conversions: number; revenue: number; clicks: number }> = {};
  for (const m of recentMetrics) {
    if (!campaignPerf[m.campaign_id]) campaignPerf[m.campaign_id] = { spend: 0, conversions: 0, revenue: 0, clicks: 0 };
    campaignPerf[m.campaign_id].spend += m.spend;
    campaignPerf[m.campaign_id].conversions += m.conversions;
    campaignPerf[m.campaign_id].revenue += m.conversion_value;
    campaignPerf[m.campaign_id].clicks += m.clicks;
  }

  // Platform aggregation
  const platformAgg: Record<string, { budget: number; spend: number; roas: number; count: number }> = {};
  let totalDailyBudget = 0;
  let totalSpendToday = 0;

  for (const camp of activeCampaigns) {
    totalDailyBudget += camp.daily_budget;

    const perf = campaignPerf[camp.id];
    const dailySpend = perf ? perf.spend / 7 : 0;
    totalSpendToday += dailySpend;

    if (!platformAgg[camp.platform]) platformAgg[camp.platform] = { budget: 0, spend: 0, roas: 0, count: 0 };
    platformAgg[camp.platform].budget += camp.daily_budget;
    platformAgg[camp.platform].spend += dailySpend;
    platformAgg[camp.platform].count++;
  }

  // Calculate ROAS per platform
  for (const [plat, agg] of Object.entries(platformAgg)) {
    const platMetrics = recentMetrics.filter((m) => m.platform === plat);
    const platRevenue = platMetrics.reduce((s, m) => s + m.conversion_value, 0);
    const platSpend = platMetrics.reduce((s, m) => s + m.spend, 0);
    agg.roas = calculateROAS(platRevenue, platSpend);
  }

  const byPlatform = Object.entries(platformAgg).map(([platform, agg]) => ({
    platform: platform as Platform,
    daily_budget: round(agg.budget),
    spend_today: round(agg.spend),
    utilization: agg.budget > 0 ? round((agg.spend / agg.budget) * 100) : 0,
    roas: agg.roas,
    campaigns_count: agg.count,
  }));

  // Generate recommendations
  const recommendations: BudgetAnalysis['recommendations'] = [];

  for (const camp of activeCampaigns) {
    const perf = campaignPerf[camp.id];
    if (!perf) continue;

    const roas = calculateROAS(perf.revenue, perf.spend);
    const cpa = calculateCPA(perf.spend, perf.conversions);

    if (optimizationGoal === 'maximize_roas') {
      if (roas > 4 && perf.spend > 0) {
        recommendations.push({
          type: 'increase',
          campaign_name: camp.name,
          platform: camp.platform,
          current_budget: camp.daily_budget,
          suggested_budget: round(camp.daily_budget * 1.3),
          reason: `High ROAS (${roas}x). Scaling budget could increase profitable conversions.`,
          expected_impact: `+${round(perf.conversions / 7 * 0.3)} conversions/day`,
        });
      } else if (roas === 0 && perf.spend > 20) {
        recommendations.push({
          type: 'pause',
          campaign_name: camp.name,
          platform: camp.platform,
          current_budget: camp.daily_budget,
          suggested_budget: 0,
          reason: 'Zero conversions with significant spend. Review targeting and conversion tracking.',
          expected_impact: `Save $${round(camp.daily_budget)}/day`,
        });
      } else if (roas < 1 && perf.spend > 10) {
        recommendations.push({
          type: 'decrease',
          campaign_name: camp.name,
          platform: camp.platform,
          current_budget: camp.daily_budget,
          suggested_budget: round(camp.daily_budget * 0.5),
          reason: `Low ROAS (${roas}x). Reducing budget to limit losses.`,
          expected_impact: `Save $${round(camp.daily_budget * 0.5)}/day`,
        });
      }
    } else if (optimizationGoal === 'minimize_cpa') {
      if (cpa > 0 && perf.conversions >= 5) {
        const avgCPA = calculateCPA(
          Object.values(campaignPerf).reduce((s, p) => s + p.spend, 0),
          Object.values(campaignPerf).reduce((s, p) => s + p.conversions, 0),
        );
        if (cpa < avgCPA * 0.7) {
          recommendations.push({
            type: 'increase',
            campaign_name: camp.name,
            platform: camp.platform,
            current_budget: camp.daily_budget,
            suggested_budget: round(camp.daily_budget * 1.25),
            reason: `Low CPA ($${cpa}) vs average ($${round(avgCPA)}). Scale this efficient campaign.`,
            expected_impact: `+${Math.round(perf.conversions / 7 * 0.25)} conversions/day at low CPA`,
          });
        }
      }
    }
  }

  // Cross-platform reallocation
  if (byPlatform.length > 1) {
    const sorted = [...byPlatform].sort((a, b) => b.roas - a.roas);
    if (sorted[0].roas > sorted[sorted.length - 1].roas * 2 && sorted[sorted.length - 1].roas > 0) {
      const best = sorted[0];
      const worst = sorted[sorted.length - 1];
      const shiftAmount = round(worst.daily_budget * 0.2);
      recommendations.push({
        type: 'reallocate',
        campaign_name: `${worst.platform} → ${best.platform}`,
        platform: best.platform,
        current_budget: worst.daily_budget,
        suggested_budget: round(worst.daily_budget - shiftAmount),
        reason: `${best.platform} ROAS (${best.roas}x) is significantly better than ${worst.platform} (${worst.roas}x).`,
        expected_impact: `Shift $${shiftAmount}/day from ${worst.platform} to ${best.platform}`,
      });
    }
  }

  return {
    total_daily_budget: round(totalDailyBudget),
    total_spend_today: round(totalSpendToday),
    utilization_rate: totalDailyBudget > 0 ? round((totalSpendToday / totalDailyBudget) * 100) : 0,
    by_platform: byPlatform,
    recommendations: recommendations.slice(0, 10),
  };
}

export async function reallocateBudget(
  fromCampaignId: string,
  toCampaignId: string,
  amount: number,
  store?: Storage,
): Promise<{ from: { id: string; name: string; new_budget: number }; to: { id: string; name: string; new_budget: number }; amount: number }> {
  const s = store ?? defaultStorage;
  const fromCamp = await s.getCampaignById(fromCampaignId);
  if (!fromCamp) throw new NotFoundError('Campaign', fromCampaignId);

  const toCamp = await s.getCampaignById(toCampaignId);
  if (!toCamp) throw new NotFoundError('Campaign', toCampaignId);

  if (amount > fromCamp.daily_budget) {
    throw new ValidationError(`Cannot reallocate $${amount}. Source campaign "${fromCamp.name}" budget is only $${fromCamp.daily_budget}.`);
  }

  const newFromBudget = round(fromCamp.daily_budget - amount);
  const newToBudget = round(toCamp.daily_budget + amount);

  await s.updateCampaign(fromCampaignId, { daily_budget: newFromBudget });
  await s.updateCampaign(toCampaignId, { daily_budget: newToBudget });

  return {
    from: { id: fromCampaignId, name: fromCamp.name, new_budget: newFromBudget },
    to: { id: toCampaignId, name: toCamp.name, new_budget: newToBudget },
    amount,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
