import { Keypair, PublicKey } from "@solana/web3.js";

export type TradeAction = "buy" | "sell" | "none";

export type StrategyName =
  | "conservative"
  | "aggressive"
  | "momentum"
  | "meanReversion"
  | "random"
  | "panicSeller"
  | "disciplinedAccumulator"
  | "dipBuyer"
  | "scalper"
  | "whale";

export type ScenarioName =
  | "bull_market"
  | "crash_market"
  | "sideways_chop"
  | "bull_then_crash"
  | "crash_then_recovery"
  | "pump_and_dump"
  | "slow_bleed"
  | "high_volatility"
  | "whale_shock"
  | "random_walk";

export interface StrategyProfile {
  name: StrategyName;
  buyThreshold: number;
  sellThreshold: number;
  cooldown: number;
  positionSizeLamports: number;
  riskLevel: number;
  drawdownSensitivity: number;
  momentumSensitivity: number;
  disciplineFactor: number;
  initialBuyPriceThreshold: number;
}

export interface TraderRuntime {
  traderId: string;
  strategy: StrategyProfile;
  keypair?: Keypair;
  publicKey?: PublicKey;
  profilePda?: PublicKey;
  lamportsBalance: number;
  lastSellStep: number;
  lastActionStep: number;
  rejectionCount: number;
  invalidActionCount: number;
  txErrorCount: number;
  totalTransactions: number;
  equityCurve: number[];
  holdingsCurve: number[];
  avgCostCurve: number[];
  acbaCurve: number[];
  buys: number;
  sells: number;
  disciplinedBuys: number;
  badBuys: number;
  maxEquityPeak: number;
  maxDrawdown: number;
  actionMarkers: ActionMarker[];
}

export interface ActionMarker {
  step: number;
  action: Exclude<TradeAction, "none">;
  price: number;
  amount: number;
}

export interface MarketSnapshot {
  step: number;
  price: number;
}

export interface DecisionContext {
  step: number;
  price: number;
  previousPrice: number;
  momentum: number;
  scenarioName: ScenarioName;
  holdings: number;
  avgCost: number;
  realizedPnlLamports: number;
  currentDrawdown: number;
}

export interface TradeDecision {
  action: TradeAction;
  tokenAmount: number;
  reason: string;
  disciplined: boolean;
  badBuy: boolean;
}

export interface FreshProfileState {
  tokenUnitsHeld: number;
  avgLamportsPerTokenScaled: bigint;
  realizedPnlLamports: number;
  disciplinedBuyCount: number;
  buyCount: number;
}

export interface SimulationCliConfig {
  scenario: ScenarioName | "all";
  steps: number;
  seed: number;
  traders: number;
  runs: number;
  output?: string;
  dryRun: boolean;
  localnet: boolean;
  progressInterval: number;
}

export interface AcbaWeights {
  disciplinedBuyRatioWeight: number;
  avgCostImprovementWeight: number;
  realizedProfitWeight: number;
  holdingDisciplineWeight: number;
  badBuyPenaltyWeight: number;
  invalidActionPenaltyWeight: number;
}

export interface TraderMetrics {
  runId: number;
  scenario: ScenarioName;
  traderId: string;
  strategy: StrategyName;
  acbaScore: number;
  avgCostImprovementPct: number;
  disciplinedBuyRatio: number;
  badBuyRatio: number;
  totalBuys: number;
  totalSells: number;
  finalHoldings: number;
  finalAverageCost: number;
  realizedPnlLamports: number;
  unrealizedPnlLamports: number;
  estimatedPortfolioValueLamports: number;
  maxDrawdownPct: number;
  volatility: number;
  sharpeLikeScore: number;
  protocolRejectionCount: number;
  invalidActionCount: number;
  txErrorCount: number;
  totalTransactions: number;
  finalRank: number;
}

export interface RunSummary {
  runId: number;
  scenario: ScenarioName;
  seed: number;
  traderCount: number;
  steps: number;
  totalTransactions: number;
  totalRejectedActions: number;
  durationMs: number;
}

export interface ScenarioSummary {
  scenario: ScenarioName;
  runs: number;
  avgAcbaScore: number;
  avgRealizedPnlLamports: number;
  avgDisciplinedBuyRatio: number;
  avgAvgCostImprovementPct: number;
  avgSharpeLikeScore: number;
  bestStrategy: StrategyName;
}

export interface StrategySummary {
  strategy: StrategyName;
  runs: number;
  avgAcbaScore: number;
  avgRealizedPnlLamports: number;
  avgDisciplinedBuyRatio: number;
  avgAvgCostImprovementPct: number;
  avgSharpeLikeScore: number;
}

export interface ChartRunData {
  runId: number;
  scenario: ScenarioName;
  seed: number;
  priceSeries: Array<{ step: number; price: number }>;
  traderCurves: Array<{
    traderId: string;
    strategy: StrategyName;
    equity: Array<{ step: number; value: number }>;
    holdings: Array<{ step: number; value: number }>;
    averageCost: Array<{ step: number; value: number }>;
    acbaScore: Array<{ step: number; value: number }>;
    markers: ActionMarker[];
    finalRank: number;
  }>;
}

export interface ChartData {
  generatedAt: string;
  config: SimulationCliConfig;
  runs: ChartRunData[];
  finalRankings: Array<{
    scenario: ScenarioName;
    runId: number;
    traderId: string;
    strategy: StrategyName;
    acbaScore: number;
    realizedPnlLamports: number;
    disciplinedBuyRatio: number;
    avgCostImprovementPct: number;
    sharpeLikeScore: number;
    rank: number;
  }>;
}
