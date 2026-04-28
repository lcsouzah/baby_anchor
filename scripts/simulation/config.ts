import { AcbaWeights, ScenarioName, SimulationCliConfig, StrategyProfile, StrategyName } from "./types";

export const LAMPORTS_PER_SOL = 1_000_000_000;
export const SCALE = 1_000_000_000n;

export const DEFAULT_CONFIG: SimulationCliConfig = {
  scenario: "bull_market",
  steps: 50,
  seed: 42,
  traders: 10,
  runs: 1,
  dryRun: false,
  localnet: true,
  progressInterval: 50,
};

export const ACBA_WEIGHTS: AcbaWeights = {
  disciplinedBuyRatioWeight: 40,
  avgCostImprovementWeight: 25,
  realizedProfitWeight: 15,
  holdingDisciplineWeight: 10,
  badBuyPenaltyWeight: 20,
  invalidActionPenaltyWeight: 10,
};

export const SCENARIOS: ScenarioName[] = [
  "bull_market",
  "crash_market",
  "sideways_chop",
  "bull_then_crash",
  "crash_then_recovery",
  "pump_and_dump",
  "slow_bleed",
  "high_volatility",
  "whale_shock",
  "random_walk",
];

const STRATEGY_ORDER: StrategyName[] = [
  "conservative",
  "aggressive",
  "momentum",
  "meanReversion",
  "random",
  "panicSeller",
  "disciplinedAccumulator",
  "dipBuyer",
  "scalper",
  "whale",
];

export const STRATEGIES: Record<StrategyName, StrategyProfile> = {
  conservative: {
    name: "conservative",
    buyThreshold: -0.04,
    sellThreshold: 0.08,
    cooldown: 5,
    positionSizeLamports: 60_000_000,
    riskLevel: 0.25,
    drawdownSensitivity: 0.8,
    momentumSensitivity: 0.3,
    disciplineFactor: 0.95,
    initialBuyPriceThreshold: 45,
  },
  aggressive: {
    name: "aggressive",
    buyThreshold: -0.01,
    sellThreshold: 0.04,
    cooldown: 2,
    positionSizeLamports: 150_000_000,
    riskLevel: 0.8,
    drawdownSensitivity: 0.4,
    momentumSensitivity: 0.7,
    disciplineFactor: 0.45,
    initialBuyPriceThreshold: 50,
  },
  momentum: {
    name: "momentum",
    buyThreshold: 0.01,
    sellThreshold: 0.03,
    cooldown: 2,
    positionSizeLamports: 100_000_000,
    riskLevel: 0.65,
    drawdownSensitivity: 0.35,
    momentumSensitivity: 0.95,
    disciplineFactor: 0.55,
    initialBuyPriceThreshold: 55,
  },
  meanReversion: {
    name: "meanReversion",
    buyThreshold: -0.05,
    sellThreshold: 0.07,
    cooldown: 3,
    positionSizeLamports: 85_000_000,
    riskLevel: 0.5,
    drawdownSensitivity: 0.65,
    momentumSensitivity: 0.25,
    disciplineFactor: 0.7,
    initialBuyPriceThreshold: 46,
  },
  random: {
    name: "random",
    buyThreshold: 0,
    sellThreshold: 0,
    cooldown: 1,
    positionSizeLamports: 75_000_000,
    riskLevel: 0.5,
    drawdownSensitivity: 0.5,
    momentumSensitivity: 0.5,
    disciplineFactor: 0.5,
    initialBuyPriceThreshold: 1000, // never use for random
  },
  panicSeller: {
    name: "panicSeller",
    buyThreshold: -0.03,
    sellThreshold: 0.02,
    cooldown: 1,
    positionSizeLamports: 65_000_000,
    riskLevel: 0.55,
    drawdownSensitivity: 1.0,
    momentumSensitivity: 0.2,
    disciplineFactor: 0.35,
    initialBuyPriceThreshold: 45,
  },
  disciplinedAccumulator: {
    name: "disciplinedAccumulator",
    buyThreshold: -0.02,
    sellThreshold: 0.15,
    cooldown: 6,
    positionSizeLamports: 90_000_000,
    riskLevel: 0.3,
    drawdownSensitivity: 0.75,
    momentumSensitivity: 0.2,
    disciplineFactor: 1.0,
    initialBuyPriceThreshold: 44,
  },
  dipBuyer: {
    name: "dipBuyer",
    buyThreshold: -0.06,
    sellThreshold: 0.06,
    cooldown: 3,
    positionSizeLamports: 110_000_000,
    riskLevel: 0.6,
    drawdownSensitivity: 0.9,
    momentumSensitivity: 0.35,
    disciplineFactor: 0.8,
    initialBuyPriceThreshold: 43,
  },
  scalper: {
    name: "scalper",
    buyThreshold: -0.005,
    sellThreshold: 0.015,
    cooldown: 1,
    positionSizeLamports: 50_000_000,
    riskLevel: 0.45,
    drawdownSensitivity: 0.4,
    momentumSensitivity: 0.85,
    disciplineFactor: 0.6,
    initialBuyPriceThreshold: 48,
  },
  whale: {
    name: "whale",
    buyThreshold: -0.025,
    sellThreshold: 0.05,
    cooldown: 2,
    positionSizeLamports: 250_000_000,
    riskLevel: 0.9,
    drawdownSensitivity: 0.55,
    momentumSensitivity: 0.6,
    disciplineFactor: 0.65,
    initialBuyPriceThreshold: 42,
  },
};

export function getStrategyByIndex(index: number): StrategyProfile {
  return STRATEGIES[STRATEGY_ORDER[index % STRATEGY_ORDER.length]!];
}

export function parseCliArgs(argv: string[]): SimulationCliConfig {
  const cfg: SimulationCliConfig = { ...DEFAULT_CONFIG };

  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const next = argv[i + 1];
    if (!key) continue;

    switch (key) {
      case "--scenario":
        if (next === "all" || SCENARIOS.includes(next as ScenarioName)) cfg.scenario = next as SimulationCliConfig["scenario"];
        i++;
        break;
      case "--steps":
        cfg.steps = Number(next ?? cfg.steps);
        i++;
        break;
      case "--seed":
        cfg.seed = Number(next ?? cfg.seed);
        i++;
        break;
      case "--traders":
        cfg.traders = Number(next ?? cfg.traders);
        i++;
        break;
      case "--runs":
        cfg.runs = Number(next ?? cfg.runs);
        i++;
        break;
      case "--output":
        if (next) cfg.output = next;
        i++;
        break;
      case "--progress":
        cfg.progressInterval = Number(next ?? cfg.progressInterval);
        i++;
        break;
      case "--dry-run":
        cfg.dryRun = true;
        cfg.localnet = false;
        break;
      case "--localnet":
        cfg.localnet = true;
        break;
      default:
        break;
    }
  }

  cfg.steps = Math.max(1, Math.floor(cfg.steps));
  cfg.runs = Math.max(1, Math.floor(cfg.runs));
  cfg.traders = Math.max(1, Math.floor(cfg.traders));
  cfg.progressInterval = Math.max(1, Math.floor(cfg.progressInterval));

  return cfg;
}
