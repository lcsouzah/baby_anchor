import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import {
  buildTraders,
  executeBuy,
  executeSell,
  fetchFreshState,
  initializeTraderOnChain,
  makeTradeDecision,
} from "./agents";
import { calculateTraderMetrics } from "./analytics";
import { ACBA_WEIGHTS, LAMPORTS_PER_SOL, parseCliArgs } from "./config";
import { appendStepLog, buildChartRunData, closeStepWriter, createOutputContext, writeChartData, writeCsvReports, writeRunSummary, writeSimulationConfig } from "./outputs";
import { createPriceSeries, listScenarios } from "./scenarios";
import { ChartData, FreshProfileState, RunSummary, ScenarioName, ScenarioSummary, StrategySummary, TraderMetrics, TraderRuntime } from "./types";

function loadDefaultWallet(): anchor.Wallet {
  const walletPath = path.join(process.env.HOME ?? ".", ".config/solana/id.json");
  const secretKey = JSON.parse(fs.readFileSync(walletPath, "utf8")) as number[];
  return new anchor.Wallet(Keypair.fromSecretKey(Uint8Array.from(secretKey)));
}

function makeRng(seed: number): () => number {
  let x = seed | 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 1_000_000) / 1_000_000;
  };
}

function computeAcbaMomentary(state: FreshProfileState, trader: TraderRuntime, price: number): number {
  const disciplinedRatio = state.buyCount > 0 ? state.disciplinedBuyCount / state.buyCount : 0;
  const avgCost = Number(state.avgLamportsPerTokenScaled) / 1_000_000_000;
  const avgCostImprovement = avgCost > 0 ? ((avgCost - price) / avgCost) * 100 : 0;
  const realizedScore = Math.max(-1, Math.min(1, state.realizedPnlLamports / (10 * LAMPORTS_PER_SOL))) * 100;
  const holdingDiscipline = Math.max(0, Math.min(1, 1 - trader.maxDrawdown)) * 100;
  const badBuyRatio = state.buyCount > 0 ? trader.badBuys / state.buyCount : 0;
  const invalidPenalty = trader.invalidActionCount + trader.rejectionCount + trader.txErrorCount;

  return (
    disciplinedRatio * ACBA_WEIGHTS.disciplinedBuyRatioWeight +
    avgCostImprovement * (ACBA_WEIGHTS.avgCostImprovementWeight / 100) +
    realizedScore * (ACBA_WEIGHTS.realizedProfitWeight / 100) +
    holdingDiscipline * (ACBA_WEIGHTS.holdingDisciplineWeight / 100) -
    badBuyRatio * ACBA_WEIGHTS.badBuyPenaltyWeight -
    invalidPenalty * ACBA_WEIGHTS.invalidActionPenaltyWeight
  );
}

export async function runSimulationLab(): Promise<void> {
  const startedAt = Date.now();
  const cfg = parseCliArgs(process.argv.slice(2));
  const output = createOutputContext(cfg);
  writeSimulationConfig(output.baseDir, cfg);

  const scenarios: ScenarioName[] = cfg.scenario === "all" ? listScenarios() : [cfg.scenario];
  const traderMetrics: TraderMetrics[] = [];
  const runSummary: RunSummary[] = [];
  const chartRuns: ChartData["runs"] = [];

  let provider: anchor.AnchorProvider | undefined;
  let program: Program<any> | undefined;

  if (!cfg.dryRun && cfg.localnet) {
    provider = process.env.ANCHOR_PROVIDER_URL && process.env.ANCHOR_WALLET
      ? anchor.AnchorProvider.env()
      : new anchor.AnchorProvider(
          new anchor.web3.Connection("http://127.0.0.1:8899", "confirmed"),
          loadDefaultWallet(),
          anchor.AnchorProvider.defaultOptions(),
        );
    anchor.setProvider(provider);
    program = anchor.workspace.BabyAnchor as Program<any>;
    console.log(`[LOCALNET] Connected: ${provider.connection.rpcEndpoint}`);
  }
  if (!program) {
    console.log("[DRY-RUN] Running without on-chain transactions.");
  }

  let runId = 0;
  for (const scenario of scenarios) {
    for (let run = 0; run < cfg.runs; run++) {
      runId += 1;
      const runSeed = cfg.seed + run * 1000 + runId * 17;
      const rng = makeRng(runSeed);
      const prices = createPriceSeries(scenario, cfg.steps, runSeed);
      const traders = buildTraders(cfg.traders);
      const runStart = Date.now();

      console.log(`\n[RUN ${runId}] scenario=${scenario} steps=${cfg.steps} seed=${runSeed} traders=${cfg.traders}`);

      if (program && provider) {
        for (const trader of traders) {
          await initializeTraderOnChain(provider, program, trader);
        }
      }

      const dryState = new Map<string, FreshProfileState>();
      for (const trader of traders) {
        dryState.set(trader.traderId, {
          tokenUnitsHeld: 0,
          avgLamportsPerTokenScaled: 0n,
          realizedPnlLamports: 0,
          disciplinedBuyCount: 0,
          buyCount: 0,
        });
      }

      for (let step = 0; step < cfg.steps; step++) {
        const price = prices[step]?.price ?? prices[prices.length - 1]!.price;
        const prevPrice = step > 0 ? prices[step - 1]!.price : price;
        const momentum = prevPrice > 0 ? (price - prevPrice) / prevPrice : 0;

        if ((step + 1) % cfg.progressInterval === 0 || step === cfg.steps - 1) {
          console.log(`  progress: step ${step + 1}/${cfg.steps}`);
        }

        for (const trader of traders) {
          const preState = program ? await fetchFreshState(program, trader) : dryState.get(trader.traderId)!;
          const avgCost = Number(preState.avgLamportsPerTokenScaled) / 1_000_000_000;
          const equity = trader.lamportsBalance + preState.tokenUnitsHeld * price;
          trader.maxEquityPeak = Math.max(trader.maxEquityPeak, equity);
          const drawdown = trader.maxEquityPeak > 0 ? (trader.maxEquityPeak - equity) / trader.maxEquityPeak : 0;
          trader.maxDrawdown = Math.max(trader.maxDrawdown, drawdown);

          const decision = makeTradeDecision(
            trader,
            {
              step,
              price,
              previousPrice: prevPrice,
              momentum,
              scenarioName: scenario,
              holdings: preState.tokenUnitsHeld,
              avgCost,
              realizedPnlLamports: preState.realizedPnlLamports,
              currentDrawdown: drawdown,
            },
            rng,
          );

          let action = decision.action;
          let amount = decision.tokenAmount;

          if (action === "buy" && trader.lamportsBalance < trader.strategy.positionSizeLamports) {
            trader.invalidActionCount += 1;
            action = "none";
            amount = 0;
          }
          if (action === "sell" && preState.tokenUnitsHeld <= 0) {
            trader.invalidActionCount += 1;
            action = "none";
            amount = 0;
          }

          if (action !== "none") {
            try {
              if (program) {
                if (action === "buy") await executeBuy(program, trader, amount);
                if (action === "sell") await executeSell(program, trader, amount, preState.avgLamportsPerTokenScaled);
              } else {
                const curr = dryState.get(trader.traderId)!;
                if (action === "buy") {
                  const lamportsIn = trader.strategy.positionSizeLamports;
                  const prevTokens = curr.tokenUnitsHeld;
                  const newTokens = prevTokens + amount;
                  const currAvg = Number(curr.avgLamportsPerTokenScaled) / 1_000_000_000;
                  const nextAvg = newTokens > 0 ? ((currAvg * prevTokens) + lamportsIn) / newTokens : 0;
                  curr.tokenUnitsHeld = newTokens;
                  curr.avgLamportsPerTokenScaled = BigInt(Math.floor(nextAvg * 1_000_000_000));
                  curr.buyCount += 1;
                  if (decision.disciplined) curr.disciplinedBuyCount += 1;
                  trader.lamportsBalance -= lamportsIn;
                  trader.totalTransactions += 1;
                } else {
                  const sellTokens = Math.min(amount, curr.tokenUnitsHeld);
                  const avg = Number(curr.avgLamportsPerTokenScaled) / 1_000_000_000;
                  const proceeds = sellTokens * avg * 1.03;
                  curr.tokenUnitsHeld = Math.max(0, curr.tokenUnitsHeld - sellTokens);
                  curr.realizedPnlLamports += Math.round(proceeds - sellTokens * avg);
                  trader.lamportsBalance += Math.round(proceeds);
                  trader.totalTransactions += 1;
                }
                dryState.set(trader.traderId, curr);
              }

              trader.lastActionStep = step;
              if (action === "sell") trader.lastSellStep = step;
              if (action === "buy") {
                trader.buys += 1;
                if (decision.disciplined) trader.disciplinedBuys += 1;
                if (decision.badBuy) trader.badBuys += 1;
              }
              if (action === "sell") trader.sells += 1;
              trader.actionMarkers.push({ step, action, price, amount });
            } catch {
              trader.rejectionCount += 1;
              trader.txErrorCount += 1;
              action = "none";
              amount = 0;
            }
          }

          const postState = program ? await fetchFreshState(program, trader) : dryState.get(trader.traderId)!;
          const postAvg = Number(postState.avgLamportsPerTokenScaled) / 1_000_000_000;
          const postEquity = trader.lamportsBalance + postState.tokenUnitsHeld * price;
          trader.equityCurve.push(postEquity);
          trader.holdingsCurve.push(postState.tokenUnitsHeld);
          trader.avgCostCurve.push(postAvg);
          trader.acbaCurve.push(computeAcbaMomentary(postState, trader, price));

          appendStepLog(output, {
            runId,
            scenario,
            step,
            trader,
            price,
            action,
            amount,
            disciplined: decision.disciplined,
            badBuy: decision.badBuy,
            holdings: postState.tokenUnitsHeld,
            avgCost: postAvg,
            realizedPnlLamports: postState.realizedPnlLamports,
            equityLamports: postEquity,
          });
        }
      }

      const finalPrice = prices[prices.length - 1]!.price;
      const computed = await Promise.all(
        traders.map(async (trader) => {
          const finalState = program ? await fetchFreshState(program, trader) : dryState.get(trader.traderId)!;
          return calculateTraderMetrics({ runId, scenario, trader, state: finalState, finalPrice });
        }),
      );
      computed.sort((a, b) => b.acbaScore - a.acbaScore);
      computed.forEach((m, idx) => traderMetrics.push({ ...m, finalRank: idx + 1 }));

      const finalRankByTrader: Record<string, number> = {};
      computed.forEach((m, idx) => {
        finalRankByTrader[m.traderId] = idx + 1;
      });

      chartRuns.push(buildChartRunData(runId, scenario, runSeed, prices, traders, finalRankByTrader));

      const durationMs = Date.now() - runStart;
      runSummary.push({
        runId,
        scenario,
        seed: runSeed,
        traderCount: cfg.traders,
        steps: cfg.steps,
        totalTransactions: traders.reduce((s, t) => s + t.totalTransactions, 0),
        totalRejectedActions: traders.reduce((s, t) => s + t.rejectionCount + t.invalidActionCount, 0),
        durationMs,
      });

      console.log(`  completed in ${(durationMs / 1000).toFixed(2)}s`);
    }
  }

  const scenarioSummary = summarizeByScenario(traderMetrics);
  const strategySummary = summarizeByStrategy(traderMetrics);
  const globalLeaderboard = [...traderMetrics].sort((a, b) => b.acbaScore - a.acbaScore);

  writeRunSummary(output.baseDir, runSummary);
  writeCsvReports(output.baseDir, traderMetrics, scenarioSummary, strategySummary, globalLeaderboard);
  writeChartData(output.baseDir, {
    generatedAt: new Date().toISOString(),
    config: cfg,
    runs: chartRuns,
    finalRankings: globalLeaderboard.map((m) => ({
      scenario: m.scenario,
      runId: m.runId,
      traderId: m.traderId,
      strategy: m.strategy,
      acbaScore: m.acbaScore,
      realizedPnlLamports: m.realizedPnlLamports,
      disciplinedBuyRatio: m.disciplinedBuyRatio,
      avgCostImprovementPct: m.avgCostImprovementPct,
      sharpeLikeScore: m.sharpeLikeScore,
      rank: m.finalRank,
    })),
  });

  await closeStepWriter(output);

  printConsoleSummary(globalLeaderboard, scenarioSummary, runSummary, startedAt);
  console.log(`\n[DONE] Outputs: ${output.baseDir}`);
}

function summarizeByScenario(metrics: TraderMetrics[]): ScenarioSummary[] {
  const grouped = new Map<ScenarioName, TraderMetrics[]>();
  for (const m of metrics) {
    const rows = grouped.get(m.scenario) ?? [];
    rows.push(m);
    grouped.set(m.scenario, rows);
  }

  return [...grouped.entries()].map(([scenario, rows]) => {
    const avgAcba = avg(rows.map((r) => r.acbaScore));
    const avgPnl = avg(rows.map((r) => r.realizedPnlLamports));
    const avgDisc = avg(rows.map((r) => r.disciplinedBuyRatio));
    const avgImprovement = avg(rows.map((r) => r.avgCostImprovementPct));
    const avgSharpe = avg(rows.map((r) => r.sharpeLikeScore));

    const stratScore = new Map<string, number[]>();
    for (const row of rows) {
      const s = stratScore.get(row.strategy) ?? [];
      s.push(row.acbaScore);
      stratScore.set(row.strategy, s);
    }
    let bestStrategy = rows[0]?.strategy ?? "conservative";
    let bestScore = -Infinity;
    for (const [s, vals] of stratScore.entries()) {
      const score = avg(vals);
      if (score > bestScore) {
        bestScore = score;
        bestStrategy = s as ScenarioSummary["bestStrategy"];
      }
    }

    return {
      scenario,
      runs: new Set(rows.map((r) => r.runId)).size,
      avgAcbaScore: avgAcba,
      avgRealizedPnlLamports: avgPnl,
      avgDisciplinedBuyRatio: avgDisc,
      avgAvgCostImprovementPct: avgImprovement,
      avgSharpeLikeScore: avgSharpe,
      bestStrategy,
    };
  });
}

function summarizeByStrategy(metrics: TraderMetrics[]): StrategySummary[] {
  const grouped = new Map<string, TraderMetrics[]>();
  for (const m of metrics) {
    const rows = grouped.get(m.strategy) ?? [];
    rows.push(m);
    grouped.set(m.strategy, rows);
  }

  return [...grouped.entries()].map(([strategy, rows]) => ({
    strategy: strategy as StrategySummary["strategy"],
    runs: rows.length,
    avgAcbaScore: avg(rows.map((r) => r.acbaScore)),
    avgRealizedPnlLamports: avg(rows.map((r) => r.realizedPnlLamports)),
    avgDisciplinedBuyRatio: avg(rows.map((r) => r.disciplinedBuyRatio)),
    avgAvgCostImprovementPct: avg(rows.map((r) => r.avgCostImprovementPct)),
    avgSharpeLikeScore: avg(rows.map((r) => r.sharpeLikeScore)),
  }));
}

function printConsoleSummary(
  leaderboard: TraderMetrics[],
  scenarioSummary: ScenarioSummary[],
  runs: RunSummary[],
  startedAt: number,
): void {
  if (leaderboard.length === 0) return;
  const bestAcba = leaderboard[0]!;
  const mostProfitable = [...leaderboard].sort((a, b) => b.realizedPnlLamports - a.realizedPnlLamports)[0]!;
  const mostDisciplined = [...leaderboard].sort((a, b) => b.disciplinedBuyRatio - a.disciplinedBuyRatio)[0]!;
  const worstBehavior = [...leaderboard].sort((a, b) => (b.badBuyRatio + b.invalidActionCount) - (a.badBuyRatio + a.invalidActionCount))[0]!;

  console.log("\n=== ACBA SIMULATION SUMMARY ===");
  console.log(`Best ACBA trader: ${bestAcba.traderId} (${bestAcba.strategy}) score=${bestAcba.acbaScore.toFixed(2)}`);
  console.log(`Most profitable trader: ${mostProfitable.traderId} pnl=${mostProfitable.realizedPnlLamports.toFixed(0)} lamports`);
  console.log(`Most disciplined trader: ${mostDisciplined.traderId} ratio=${mostDisciplined.disciplinedBuyRatio.toFixed(3)}`);
  console.log(`Worst behavior trader: ${worstBehavior.traderId} bad_buy_ratio=${worstBehavior.badBuyRatio.toFixed(3)}`);

  console.log("Best strategy by scenario:");
  for (const s of scenarioSummary) {
    console.log(`  - ${s.scenario}: ${s.bestStrategy}`);
  }

  console.log("Global leaderboard top 10:");
  leaderboard.slice(0, 10).forEach((row, i) => {
    console.log(`  ${i + 1}. ${row.traderId} [${row.strategy}] ACBA=${row.acbaScore.toFixed(2)} PnL=${row.realizedPnlLamports.toFixed(0)}`);
  });

  console.log("\nStrategy trade counts:");
  const strategyStats = new Map<string, { buys: number; sells: number; count: number }>();
  for (const trader of leaderboard) {
    const key = trader.strategy;
    if (!strategyStats.has(key)) {
      strategyStats.set(key, { buys: 0, sells: 0, count: 0 });
    }
    const stats = strategyStats.get(key)!;
    stats.buys += trader.totalBuys;
    stats.sells += trader.totalSells;
    stats.count += 1;
  }
  for (const [strategy, stats] of strategyStats) {
    console.log(`  ${strategy}: ${stats.count} traders, ${stats.buys} buys, ${stats.sells} sells`);
  }

  const totalTx = runs.reduce((sum, r) => sum + r.totalTransactions, 0);
  const rejected = runs.reduce((sum, r) => sum + r.totalRejectedActions, 0);
  console.log(`Total transactions sent: ${totalTx}`);
  console.log(`Total rejected actions: ${rejected}`);
  console.log(`Runtime duration: ${((Date.now() - startedAt) / 1000).toFixed(2)}s`);
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, x) => sum + x, 0) / values.length;
}

if (require.main === module) {
  runSimulationLab().catch((error) => {
    console.error("Simulation failed", error);
    process.exitCode = 1;
  });
}
