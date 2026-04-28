# ACBA Simulation Lab

This project now includes a long-running TypeScript simulation lab for ACBA behavior testing on Anchor local validator or in dry-run mode.

## Commands

### Smoke test (quick)
```bash
yarn simulate --scenario bull_market --steps 50 --runs 1 --traders 10
```

### Run all scenarios
```bash
yarn simulate --scenario all --steps 100 --runs 2 --seed 42
```

### Long simulation
```bash
yarn simulate --scenario all --steps 10000 --runs 100 --seed 42 --traders 20
```

### Dry-run performance mode
```bash
yarn simulate --scenario all --steps 10000 --runs 20 --dry-run --traders 25
```

## CLI arguments
- `--scenario` one of: `bull_market`, `crash_market`, `sideways_chop`, `bull_then_crash`, `crash_then_recovery`, `pump_and_dump`, `slow_bleed`, `high_volatility`, `whale_shock`, `random_walk`, or `all`
- `--steps` number of market steps per run
- `--seed` deterministic seed base
- `--traders` trader count per run
- `--runs` runs per scenario
- `--output` optional output directory override
- `--dry-run` no on-chain tx; same decision logic
- `--localnet` force localnet mode
- `--progress` print progress every N steps

## Output folder
Outputs are written to:
`simulation-output/{timestamp}/`

Generated files:
- `step_log.csv`
- `trader_summary.csv`
- `scenario_summary.csv`
- `strategy_comparison.csv`
- `global_leaderboard.csv`
- `per_run_summary.csv`
- `chart_data.json`
- `simulation_config.json`

## ACBA score formula
Weights are configurable in `scripts/simulation/config.ts`:

```text
ACBA Score =
(disciplinedBuyRatio * 40)
+ (avgCostImprovementPct * 25)
+ (realizedProfitScore * 15)
+ (holdingDisciplineScore * 10)
- (badBuyRatio * 20)
- (invalidActionPenalty * 10)
```

Implementation notes:
- `disciplinedBuyRatio = disciplinedBuys / totalBuys`
- `avgCostImprovementPct = ((avgCost - finalPrice) / avgCost) * 100`
- `realizedProfitScore` normalized realized PnL score
- `holdingDisciplineScore` derived from max drawdown
- `invalidActionPenalty = invalid + rejections + txErrors`

## chart_data.json format
Designed for Flutter/Python/Excel/Sheets/web dashboards:
- per-run `priceSeries`
- per-trader `equity`, `holdings`, `averageCost`, `acbaScore`
- buy/sell `markers`
- final rank per trader
- global `finalRankings`

## Long-run stability behavior
- Streams `step_log.csv` with write stream to avoid huge memory buffers.
- Handles non-critical tx errors per trader and continues run.
- Counts rejection/invalid/tx errors in analytics.
- Prints progress every N steps (`--progress`).
- Writes config and summary artifacts for reproducibility.

## Localnet compatibility
When not using `--dry-run`, the simulation:
- connects to Anchor local validator (`http://127.0.0.1:8899` unless env provider is set),
- creates trader keypairs,
- airdrops SOL,
- initializes ACBA profile PDA,
- fetches fresh on-chain profile state before each decision.
