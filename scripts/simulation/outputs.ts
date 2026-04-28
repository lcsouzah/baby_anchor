import * as fs from "fs";
import * as path from "path";
import {
  ChartData,
  ChartRunData,
  RunSummary,
  ScenarioSummary,
  SimulationCliConfig,
  StrategySummary,
  TraderMetrics,
  TraderRuntime,
} from "./types";

export interface OutputContext {
  baseDir: string;
  stepLogPath: string;
  stepWriter: fs.WriteStream;
}

export function createOutputContext(config: SimulationCliConfig): OutputContext {
  const ts = new Date().toISOString().replaceAll(":", "-");
  const baseDir = config.output ? path.resolve(config.output) : path.join(process.cwd(), "simulation-output", ts);
  fs.mkdirSync(baseDir, { recursive: true });

  const stepLogPath = path.join(baseDir, "step_log.csv");
  const stepWriter = fs.createWriteStream(stepLogPath, { flags: "w" });
  stepWriter.write(
    "run_id,scenario,step,trader_id,strategy,price,action,amount,disciplined,bad_buy,holdings,avg_cost,realized_pnl_lamports,equity_lamports,rejection_count,invalid_action_count,tx_error_count\n",
  );

  return { baseDir, stepLogPath, stepWriter };
}

export function appendStepLog(
  out: OutputContext,
  row: {
    runId: number;
    scenario: string;
    step: number;
    trader: TraderRuntime;
    price: number;
    action: string;
    amount: number;
    disciplined: boolean;
    badBuy: boolean;
    holdings: number;
    avgCost: number;
    realizedPnlLamports: number;
    equityLamports: number;
  },
): void {
  out.stepWriter.write(
    [
      row.runId,
      row.scenario,
      row.step,
      row.trader.traderId,
      row.trader.strategy.name,
      row.price.toFixed(6),
      row.action,
      row.amount,
      row.disciplined ? 1 : 0,
      row.badBuy ? 1 : 0,
      row.holdings,
      row.avgCost.toFixed(6),
      row.realizedPnlLamports,
      Math.round(row.equityLamports),
      row.trader.rejectionCount,
      row.trader.invalidActionCount,
      row.trader.txErrorCount,
    ].join(",") + "\n",
  );
}

export async function closeStepWriter(out: OutputContext): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    out.stepWriter.end(() => resolve());
    out.stepWriter.on("error", reject);
  });
}

export function writeCsvReports(
  baseDir: string,
  traderMetrics: TraderMetrics[],
  scenarioSummary: ScenarioSummary[],
  strategySummary: StrategySummary[],
  globalLeaderboard: TraderMetrics[],
): void {
  writeCsv(
    path.join(baseDir, "trader_summary.csv"),
    [
      "run_id",
      "scenario",
      "trader_id",
      "strategy",
      "acba_score",
      "avg_cost_improvement_pct",
      "disciplined_buy_ratio",
      "bad_buy_ratio",
      "total_buys",
      "total_sells",
      "final_holdings",
      "final_average_cost",
      "realized_pnl_lamports",
      "unrealized_pnl_lamports",
      "estimated_portfolio_value_lamports",
      "max_drawdown_pct",
      "volatility",
      "sharpe_like_score",
      "protocol_rejection_count",
      "invalid_action_count",
      "tx_error_count",
      "total_transactions",
      "final_rank",
    ],
    traderMetrics.map((m) => [
      m.runId,
      m.scenario,
      m.traderId,
      m.strategy,
      num(m.acbaScore),
      num(m.avgCostImprovementPct),
      num(m.disciplinedBuyRatio),
      num(m.badBuyRatio),
      m.totalBuys,
      m.totalSells,
      m.finalHoldings,
      num(m.finalAverageCost),
      Math.round(m.realizedPnlLamports),
      Math.round(m.unrealizedPnlLamports),
      Math.round(m.estimatedPortfolioValueLamports),
      num(m.maxDrawdownPct),
      num(m.volatility),
      num(m.sharpeLikeScore),
      m.protocolRejectionCount,
      m.invalidActionCount,
      m.txErrorCount,
      m.totalTransactions,
      m.finalRank,
    ]),
  );

  writeCsv(
    path.join(baseDir, "scenario_summary.csv"),
    [
      "scenario",
      "runs",
      "avg_acba_score",
      "avg_realized_pnl_lamports",
      "avg_disciplined_buy_ratio",
      "avg_avg_cost_improvement_pct",
      "avg_sharpe_like_score",
      "best_strategy",
    ],
    scenarioSummary.map((s) => [
      s.scenario,
      s.runs,
      num(s.avgAcbaScore),
      Math.round(s.avgRealizedPnlLamports),
      num(s.avgDisciplinedBuyRatio),
      num(s.avgAvgCostImprovementPct),
      num(s.avgSharpeLikeScore),
      s.bestStrategy,
    ]),
  );

  writeCsv(
    path.join(baseDir, "strategy_comparison.csv"),
    [
      "strategy",
      "runs",
      "avg_acba_score",
      "avg_realized_pnl_lamports",
      "avg_disciplined_buy_ratio",
      "avg_avg_cost_improvement_pct",
      "avg_sharpe_like_score",
    ],
    strategySummary.map((s) => [
      s.strategy,
      s.runs,
      num(s.avgAcbaScore),
      Math.round(s.avgRealizedPnlLamports),
      num(s.avgDisciplinedBuyRatio),
      num(s.avgAvgCostImprovementPct),
      num(s.avgSharpeLikeScore),
    ]),
  );

  writeCsv(
    path.join(baseDir, "global_leaderboard.csv"),
    ["rank", "scenario", "run_id", "trader_id", "strategy", "acba_score", "realized_pnl_lamports", "disciplined_buy_ratio", "avg_cost_improvement_pct", "sharpe_like_score"],
    globalLeaderboard.map((m, idx) => [
      idx + 1,
      m.scenario,
      m.runId,
      m.traderId,
      m.strategy,
      num(m.acbaScore),
      Math.round(m.realizedPnlLamports),
      num(m.disciplinedBuyRatio),
      num(m.avgCostImprovementPct),
      num(m.sharpeLikeScore),
    ]),
  );
}

export function writeRunSummary(baseDir: string, rows: RunSummary[]): void {
  writeCsv(
    path.join(baseDir, "per_run_summary.csv"),
    ["run_id", "scenario", "seed", "trader_count", "steps", "total_transactions", "total_rejected_actions", "duration_ms"],
    rows.map((r) => [r.runId, r.scenario, r.seed, r.traderCount, r.steps, r.totalTransactions, r.totalRejectedActions, r.durationMs]),
  );
}

export function writeChartData(baseDir: string, chartData: ChartData): void {
  fs.writeFileSync(path.join(baseDir, "chart_data.json"), JSON.stringify(chartData, null, 2));
}

export function writeSimulationConfig(baseDir: string, config: SimulationCliConfig): void {
  fs.writeFileSync(path.join(baseDir, "simulation_config.json"), JSON.stringify(config, null, 2));
}

export function buildChartRunData(
  runId: number,
  scenario: ChartRunData["scenario"],
  seed: number,
  prices: Array<{ step: number; price: number }>,
  traders: TraderRuntime[],
  finalRanks: Record<string, number>,
): ChartRunData {
  return {
    runId,
    scenario,
    seed,
    priceSeries: prices,
    traderCurves: traders.map((t) => ({
      traderId: t.traderId,
      strategy: t.strategy.name,
      equity: t.equityCurve.map((v, i) => ({ step: i, value: v })),
      holdings: t.holdingsCurve.map((v, i) => ({ step: i, value: v })),
      averageCost: t.avgCostCurve.map((v, i) => ({ step: i, value: v })),
      acbaScore: t.acbaCurve.map((v, i) => ({ step: i, value: v })),
      markers: t.actionMarkers,
      finalRank: finalRanks[t.traderId] ?? 0,
    })),
  };
}

function writeCsv(file: string, header: string[], rows: Array<Array<string | number>>): void {
  const lines = [header.join(",")];
  for (const row of rows) lines.push(row.join(","));
  fs.writeFileSync(file, lines.join("\n") + "\n");
}

function num(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : "0";
}