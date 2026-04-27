import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import type { BabyAnchor } from "../target/types/baby_anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import fs from "fs";
import path from "path";

const SCALE = 1_000_000_000n;
const LAMPORTS_PER_SOL = 1_000_000_000;

interface TraderState {
  trader: Keypair;
  publicKey: PublicKey;
  profilePda: PublicKey;
  lamportsBalance: number;
  steps: StepRecord[];
}

interface StepRecord {
  step: number;
  marketPrice: number;
  action: "none" | "buy" | "sell";
  amount: number;
  avgCostBasis: number;
  realizedPnl: number;
  tokenHeld: number;
  totalIn: number;
  totalOut: number;
}

interface MarketSnapshot {
  step: number;
  price: number;
}

const OUTPUT_DIR = path.join(process.cwd(), "simulation-output");
const NUM_TRADERS = 5;
const NUM_STEPS = 50;
const INITIAL_LAMPORTS = 10 * LAMPORTS_PER_SOL;
const STEP_SIZE_LAMPORTS = 100_000_000; // ~0.1 SOL per trade

async function main() {
  // Setup
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BabyAnchor as Program<BabyAnchor>;
  const acbaAccount = program.account.acbaProfile!;

  console.log(`[SIMULATION] Connecting to localnet at ${provider.connection.rpcEndpoint}`);
  console.log(`[CONFIG] Traders: ${NUM_TRADERS}, Steps: ${NUM_STEPS}, Init Balance: ${INITIAL_LAMPORTS / LAMPORTS_PER_SOL} SOL`);

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Initialize traders
  console.log("\n[INIT] Initializing trader accounts...");
  const traders: TraderState[] = [];

  for (let i = 0; i < NUM_TRADERS; i++) {
    const trader = Keypair.generate();
    const publicKey = trader.publicKey;

    // Airdrop SOL
    const sig = await provider.connection.requestAirdrop(publicKey, INITIAL_LAMPORTS);
    await provider.connection.confirmTransaction(sig, "confirmed");

    // Derive profile PDA
    const [profilePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("acba"), publicKey.toBuffer()],
      program.programId
    );

    // Initialize profile
    await program.methods
      .initializeProfile()
      .accountsPartial({
        profile: profilePda,
        owner: publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([trader])
      .rpc();

    traders.push({
      trader,
      publicKey,
      profilePda,
      lamportsBalance: INITIAL_LAMPORTS,
      steps: [],
    });

    console.log(`  [Trader ${i + 1}] ${publicKey.toBase58().slice(0, 8)}...`);
  }

  // Generate market prices (simple sine wave + random walk)
  console.log("\n[MARKET] Generating price simulation...");
  const marketPrices = generateMarketPrices(NUM_STEPS);

  // Run simulation
  console.log(`\n[TRADING] Running ${NUM_STEPS} market steps...\n`);

  for (let step = 0; step < NUM_STEPS; step++) {
    const price = marketPrices[step];
    console.log(`Step ${step + 1}/${NUM_STEPS} | Market Price: ${price.toFixed(2)}`);

    for (let i = 0; i < NUM_TRADERS; i++) {
      const trader = traders[i];
      const decision = makeTradeDecision(trader, price, step);

      if (decision.action !== "none") {
        try {
          if (decision.action === "buy") {
            await executeBuy(program, trader, decision.amount);
          } else if (decision.action === "sell") {
            await executeSell(program, acbaAccount, trader, decision.amount);
          }

          // Fetch updated state
          const state = await acbaAccount.fetch(trader.profilePda);
          const avgScaled = new BN(state.avgLamportsPerTokenScaled.toString());
          const avgCostBasis = avgScaled.toNumber() / 1_000_000_000;

          const record: StepRecord = {
            step,
            marketPrice: price,
            action: decision.action,
            amount: decision.amount,
            avgCostBasis,
            realizedPnl: state.realizedPnlLamports.toNumber(),
            tokenHeld: state.tokenUnitsHeld.toNumber(),
            totalIn: state.totalLamportsIn.toNumber(),
            totalOut: state.totalTokenUnitsOut.toNumber(),
          };

          trader.steps.push(record);
          console.log(
            `    Trader ${i + 1}: ${decision.action.toUpperCase()} ${decision.amount} tokens @ ${price.toFixed(2)}`
          );
        } catch (error) {
          console.error(`    Trader ${i + 1} error: ${(error as Error).message}`);
        }
      }
    }
  }

  // Generate CSV reports
  console.log("\n[OUTPUT] Generating CSV reports...");
  generateMasterCSV(traders, marketPrices);
  generateTraderCSVs(traders);

  console.log(`\n[DONE] Simulation complete. Output in: ${OUTPUT_DIR}`);
}

function generateMarketPrices(numSteps: number): number[] {
  const prices: number[] = [];
  let price = 45; // Initial price in "lamports per token"

  for (let i = 0; i < numSteps; i++) {
    // Sine wave + random walk
    const sine = 5 * Math.sin((i / numSteps) * Math.PI * 2);
    const randomWalk = (Math.random() - 0.5) * 4;
    price = Math.max(20, Math.min(100, price + sine / 5 + randomWalk / 5));
    prices.push(price);
  }

  return prices;
}

function makeTradeDecision(trader: TraderState, marketPrice: number, step: number): { action: "buy" | "sell" | "none"; amount: number } {
  // Simple strategy: buy if price is low, sell if holding and profitable
  const lastStep = trader.steps[trader.steps.length - 1];

  // Buy logic: if price is below 45 and we have balance
  if (marketPrice < 45 && trader.lamportsBalance > STEP_SIZE_LAMPORTS) {
    const tokenAmount = Math.floor(STEP_SIZE_LAMPORTS / marketPrice);
    return { action: "buy", amount: Math.max(1, tokenAmount) };
  }

  // Sell logic: if we're holding and profitable
  if (lastStep && lastStep.tokenHeld > 0 && marketPrice > lastStep.avgCostBasis * 1.1) {
    const sellAmount = Math.min(lastStep.tokenHeld, Math.max(1, Math.floor(lastStep.tokenHeld * 0.3)));
    return { action: "sell", amount: sellAmount };
  }

  return { action: "none", amount: 0 };
}

async function executeBuy(program: Program<BabyAnchor>, trader: TraderState, tokenAmount: number) {
  const lamportsIn = new BN(Math.floor(STEP_SIZE_LAMPORTS));
  const tokensOut = new BN(tokenAmount);

  await program.methods
    .recordBuy(lamportsIn, tokensOut)
    .accountsPartial({
      profile: trader.profilePda,
      owner: trader.publicKey,
    })
    .signers([trader.trader])
    .rpc();

  trader.lamportsBalance -= STEP_SIZE_LAMPORTS;
}

async function executeSell(
  program: Program<BabyAnchor>,
  acbaAccount: any,
  trader: TraderState,
  tokenAmount: number
) {
  const state = await acbaAccount.fetch(trader.profilePda);
  const avgScaled = new BN(state.avgLamportsPerTokenScaled.toString());

  // Estimate proceeds = avgCostBasis * tokenAmount * 1.05 (5% gain)
  const proceeds = avgScaled
    .mul(new BN(tokenAmount))
    .mul(new BN(105))
    .div(new BN(100))
    .div(new BN(SCALE));

  const lamportsOut = new BN(proceeds.toNumber());
  const tokensSold = new BN(tokenAmount);

  await program.methods
    .recordSell(lamportsOut, tokensSold)
    .accountsPartial({
      profile: trader.profilePda,
      owner: trader.publicKey,
    })
    .signers([trader.trader])
    .rpc();

  trader.lamportsBalance += proceeds.toNumber();
}

function generateMasterCSV(traders: TraderState[], prices: number[]) {
  const rows: string[] = ["Step,MarketPrice," + traders.map((_, i) => `Trader${i + 1}_Action,Trader${i + 1}_Holding`).join(",")];

  for (let step = 0; step < prices.length; step++) {
    let row = `${step},${prices[step].toFixed(2)}`;

    for (const trader of traders) {
      const stepRecord = trader.steps.find((r) => r.step === step);
      const action = stepRecord?.action || "none";
      const holding = stepRecord?.tokenHeld || 0;
      row += `,${action},${holding}`;
    }

    rows.push(row);
  }

  const csvPath = path.join(OUTPUT_DIR, "simulation-master.csv");
  fs.writeFileSync(csvPath, rows.join("\n"));
  console.log(`  Master CSV: ${csvPath}`);
}

function generateTraderCSVs(traders: TraderState[]) {
  traders.forEach((trader, idx) => {
    const rows = [
      "Step,MarketPrice,Action,Amount,AvgCostBasis,RealizedPnL,TokenHeld,TotalLamportsIn,TotalTokensOut",
    ];

    trader.steps.forEach((step) => {
      rows.push(
        `${step.step},${step.marketPrice.toFixed(2)},${step.action},${step.amount},${step.avgCostBasis.toFixed(2)},${step.realizedPnl},${step.tokenHeld},${step.totalIn},${step.totalOut}`
      );
    });

    const csvPath = path.join(OUTPUT_DIR, `trader-${idx + 1}.csv`);
    fs.writeFileSync(csvPath, rows.join("\n"));
  });

  console.log(`  Trader CSVs: ${OUTPUT_DIR}/trader-{1..${NUM_TRADERS}}.csv`);
}

main().catch(console.error);
