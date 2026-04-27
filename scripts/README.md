# Baby Anchor Simulation Runner

A minimal TypeScript-based market simulation runner for the baby_anchor Solana program. Simulates 5 traders across 50 market steps with CSV output.

## Configuration

- **Traders**: 5
- **Market Steps**: 50
- **Cluster**: Localnet only
- **Initial Balance**: ~10 SOL per trader
- **Trade Size**: ~0.1 SOL per trade

## Prerequisites

1. Solana CLI with localnet running:
   ```bash
   solana-test-validator
   ```

2. Dependencies installed:
   ```bash
   yarn install
   ```

3. Baby Anchor program built:
   ```bash
   anchor build
   ```

## Running the Simulation

```bash
yarn simulate
```

Or directly:
```bash
ts-node -P ./tsconfig.json scripts/simulation-runner.ts
```

## Output Files

Simulation results are saved to `simulation-output/`:

- **`simulation-master.csv`** — Market prices and all traders' actions per step
- **`trader-{1..5}.csv`** — Individual trader detailed trading history

### CSV Columns

**Master CSV**:
- `Step` — Market step number
- `MarketPrice` — Simulated market price
- `Trader{N}_Action` — Action taken (buy/sell/none)
- `Trader{N}_Holding` — Token units held

**Trader CSV**:
- `Step` — Market step
- `MarketPrice` — Price at step
- `Action` — Trade action
- `Amount` — Tokens traded
- `AvgCostBasis` — Average cost per token
- `RealizedPnL` — Realized profit/loss in lamports
- `TokenHeld` — Total tokens held
- `TotalLamportsIn` — Total lamports invested
- `TotalTokensOut` — Total tokens purchased

## Trading Strategy

The simulation uses a simple strategy:
- **Buy**: When market price < 45 and trader has balance
- **Sell**: When holding tokens and price is >10% above average cost basis (sells 30% of holdings)
- **Price Model**: Sine wave + random walk (oscillates between ~20-100)

## Notes

- Only targets **localnet** (no devnet/mainnet support)
- Does not modify the Rust program
- Traders are randomly generated for each run
- Simulation requires active localnet validator
