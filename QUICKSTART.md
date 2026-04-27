# Baby Anchor Simulation Runner - Quick Start

## What's Been Built

A minimal TypeScript simulation runner for the baby_anchor Solana program with:
- ✅ 5 trader accounts (randomly generated keypairs)
- ✅ 50 market steps with dynamic price simulation
- ✅ Buy/sell trading logic with discipline tracking
- ✅ CSV output for master and individual traders
- ✅ Localnet-only configuration
- ✅ No Rust modifications

## Project Structure

```
scripts/
├── simulation-runner.ts    # Main simulation engine
├── README.md              # Detailed documentation
├── run-simulation.sh      # Setup & run helper script
└── QUICKSTART.md          # This file
```

## Quick Start (3 Steps)

### Step 1: Start Localnet
```bash
solana-test-validator
```
(Keep running in a separate terminal)

### Step 2: Build Program
```bash
anchor build
```

### Step 3: Run Simulation
```bash
yarn simulate
```

## Output

Results are saved to **`simulation-output/`**:

| File | Purpose |
|------|---------|
| `simulation-master.csv` | Market prices + all trader actions per step |
| `trader-1.csv` ... `trader-5.csv` | Detailed trading history per trader |

### Column Reference

**Master CSV**: Step, MarketPrice, Trader1_Action, Trader1_Holding, ...
**Trader CSV**: Step, MarketPrice, Action, Amount, AvgCostBasis, RealizedPnL, TokenHeld, TotalLamportsIn, TotalTokensOut

## Configuration (Editable in script)

```typescript
const NUM_TRADERS = 5;              // 5 traders
const NUM_STEPS = 50;               // 50 market steps
const INITIAL_LAMPORTS = 10 * LAMPORTS_PER_SOL;  // 10 SOL each
const STEP_SIZE_LAMPORTS = 100_000_000;          // 0.1 SOL per trade
```

## Trading Strategy

The simulation uses a simple strategy:
- **BUY**: When market price < 45 (undervalued)
- **SELL**: When holding tokens AND price > 110% of average cost basis
- **Price Model**: Sine wave + random walk (oscillates between 20-100)

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Connection refused" | Start `solana-test-validator` |
| "Program not found" | Run `anchor build` |
| "Permission denied" on script | Run `chmod +x scripts/run-simulation.sh` |
| Empty trader steps | Normal if trades don't happen at certain prices |

## Example Output

```
[SIMULATION] Connecting to localnet at http://localhost:8899
[CONFIG] Traders: 5, Steps: 50, Init Balance: 10 SOL

[INIT] Initializing trader accounts...
  [Trader 1] 8mK5a3xJ...
  [Trader 2] 3dL9k7pP...
  ...

[MARKET] Generating price simulation...

[TRADING] Running 50 market steps...
Step 1/50 | Market Price: 44.23
    Trader 1: BUY 2 tokens @ 44.23
    Trader 3: SELL 1 tokens @ 48.50
...

[OUTPUT] Generating CSV reports...
  Master CSV: /home/xpell/baby_anchor/simulation-output/simulation-master.csv
  Trader CSVs: /home/xpell/baby_anchor/simulation-output/trader-{1..5}.csv

[DONE] Simulation complete.
```

## Next Steps

- Modify `makeTradeDecision()` to implement different trading strategies
- Adjust configuration constants for different market conditions
- Analyze CSV outputs to validate trader performance
- Scale to more traders/steps as needed
