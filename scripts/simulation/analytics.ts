import { ACBA_WEIGHTS, LAMPORTS_PER_SOL } from "./config";
import { FreshProfileState, TraderMetrics, TraderRuntime } from "./types";

export function calculateTraderMetrics(
  params: {
    runId: number;
    scenario: TraderMetrics["scenario"];
    trader: TraderRuntime;
    state: FreshProfileState;
    finalPrice: number;
  },
): Omit<TraderMetrics, "finalRank"> {
  const { runId, scenario, trader, state, finalPrice } = params;

  const avgCost = Number(state.avgLamportsPerTokenScaled) / 1_000_000_000;
  const holdings = state.tokenUnitsHeld;
  const totalBuys = Math.max(trader.buys, state.buyCount);
  const disciplinedBuys = Math.max(trader.disciplinedBuys, state.disciplinedBuyCount);

  const disciplinedBuyRatio = totalBuys > 0 ? disciplinedBuys / totalBuys : 0;
  const badBuyRatio = totalBuys > 0 ? trader.badBuys / totalBuys : 0;

  const avgCostImprovementPct = avgCost > 0 ? ((avgCost - finalPrice) / avgCost) * 100 : 0;
  const realizedPnl = state.realizedPnlLamports;
  const unrealized = holdings * (finalPrice - avgCost);
  const portfolioValue = trader.lamportsBalance + holdings * finalPrice;

  const returns = computeReturns(trader.equityCurve);
  const volatility = stdDev(returns);
  const meanRet = mean(returns);
  const sharpeLike = volatility > 0 ? meanRet / volatility : 0;

  const realizedProfitScore = clamp(realizedPnl / (10 * LAMPORTS_PER_SOL), -1, 1) * 100;
  const holdingDisciplineScore = clamp(1 - trader.maxDrawdown, 0, 1) * 100;
  const invalidPenalty = trader.invalidActionCount + trader.rejectionCount + trader.txErrorCount;

  const acbaScore =
    disciplinedBuyRatio * ACBA_WEIGHTS.disciplinedBuyRatioWeight +
    avgCostImprovementPct * (ACBA_WEIGHTS.avgCostImprovementWeight / 100) +
    realizedProfitScore * (ACBA_WEIGHTS.realizedProfitWeight / 100) +
    holdingDisciplineScore * (ACBA_WEIGHTS.holdingDisciplineWeight / 100) -
    badBuyRatio * ACBA_WEIGHTS.badBuyPenaltyWeight -
    invalidPenalty * ACBA_WEIGHTS.invalidActionPenaltyWeight;

  return {
    runId,
    scenario,
    traderId: trader.traderId,
    strategy: trader.strategy.name,
    acbaScore,
    avgCostImprovementPct,
    disciplinedBuyRatio,
    badBuyRatio,
    totalBuys,
    totalSells: trader.sells,
    finalHoldings: holdings,
    finalAverageCost: avgCost,
    realizedPnlLamports: realizedPnl,
    unrealizedPnlLamports: unrealized,
    estimatedPortfolioValueLamports: portfolioValue,
    maxDrawdownPct: trader.maxDrawdown * 100,
    volatility,
    sharpeLikeScore: sharpeLike,
    protocolRejectionCount: trader.rejectionCount,
    invalidActionCount: trader.invalidActionCount,
    txErrorCount: trader.txErrorCount,
    totalTransactions: trader.totalTransactions,
  };
}

function computeReturns(curve: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1];
    const curr = curve[i];
    if (!prev || !curr || prev <= 0) continue;
    out.push((curr - prev) / prev);
  }
  return out;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, x) => sum + x, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, x) => sum + (x - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
