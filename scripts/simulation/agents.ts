import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection } from "@solana/web3.js";
import { LAMPORTS_PER_SOL, SCALE, getStrategyByIndex } from "./config";
import { DecisionContext, FreshProfileState, TradeDecision, TraderRuntime } from "./types";

export const INITIAL_LAMPORTS = 10 * LAMPORTS_PER_SOL;

async function confirmWithRetry(connection: Connection, signature: string, maxRetries = 3): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const latest = await connection.getLatestBlockhash("confirmed");
      await connection.confirmTransaction({
        signature,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      }, "confirmed");
      return;
    } catch (error) {
      console.error(`Transaction confirmation failed (attempt ${attempt + 1}/${maxRetries}): ${(error as Error).message}`);
      if (attempt === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

export function buildTraders(traderCount: number): TraderRuntime[] {
  const traders: TraderRuntime[] = [];
  for (let i = 0; i < traderCount; i++) {
    const strategy = getStrategyByIndex(i);
    traders.push({
      traderId: `trader_${String(i + 1).padStart(3, "0")}`,
      strategy,
      lamportsBalance: INITIAL_LAMPORTS,
      lastSellStep: -999999,
      lastActionStep: -999999,
      rejectionCount: 0,
      invalidActionCount: 0,
      txErrorCount: 0,
      totalTransactions: 0,
      equityCurve: [],
      holdingsCurve: [],
      avgCostCurve: [],
      acbaCurve: [],
      buys: 0,
      sells: 0,
      disciplinedBuys: 0,
      badBuys: 0,
      maxEquityPeak: INITIAL_LAMPORTS,
      maxDrawdown: 0,
      actionMarkers: [],
    });
  }
  return traders;
}

export function makeTradeDecision(trader: TraderRuntime, context: DecisionContext, random: () => number): TradeDecision {
  const { strategy } = trader;
  const stepSinceAction = context.step - trader.lastActionStep;
  if (stepSinceAction < strategy.cooldown) {
    return { action: "none", tokenAmount: 0, reason: "cooldown", disciplined: true, badBuy: false };
  }

  const momentumSignal = context.momentum * strategy.momentumSensitivity;
  const drawdownSignal = context.currentDrawdown * strategy.drawdownSensitivity;
  const avgCost = context.avgCost > 0 ? context.avgCost : context.price;
  const relativeToAvgCost = (context.price - avgCost) / Math.max(avgCost, 1e-9);

  const buySignal = strategy.buyThreshold - relativeToAvgCost - drawdownSignal + momentumSignal * 0.35;
  const sellSignal = relativeToAvgCost - strategy.sellThreshold - momentumSignal * 0.25 + drawdownSignal * 0.15;

  const lamportsSize = Math.max(1, Math.floor(strategy.positionSizeLamports * (0.8 + strategy.riskLevel * 0.6)));
  const tokenAmount = Math.max(1, Math.floor(lamportsSize / Math.max(context.price, 0.000001)));

  let action: TradeDecision["action"] = "none";
  let reason = "no_signal";

  if (strategy.name === "random") {
    if (random() < 0.18) {
      action = "buy";
      reason = "random_buy";
    } else if (context.holdings > 0 && random() < 0.16) {
      action = "sell";
      reason = "random_sell";
    }
  } else {
    if (buySignal > 0.03) {
      action = "buy";
      reason = "buy_signal";
    } else if (context.holdings > 0 && sellSignal > 0.02) {
      action = "sell";
      reason = "sell_signal";
    }
  }

  if (strategy.name === "panicSeller" && context.currentDrawdown > 0.07 && context.holdings > 0) {
    action = "sell";
    reason = "panic_drawdown";
  }

  if (strategy.name === "disciplinedAccumulator" && relativeToAvgCost < -0.02) {
    action = "buy";
    reason = "disciplined_accumulate";
  }

  if (strategy.name === "scalper" && context.momentum > 0.01 && context.holdings > 0) {
    action = "sell";
    reason = "scalp_momentum";
  }

  if (action === "sell") {
    const baseSell = Math.floor(context.holdings * (0.2 + strategy.riskLevel * 0.5));
    return {
      action,
      tokenAmount: Math.max(1, Math.min(context.holdings, baseSell)),
      reason,
      disciplined: true,
      badBuy: false,
    };
  }

  if (action === "buy") {
    const disciplined = relativeToAvgCost <= 0.01 || strategy.disciplineFactor > 0.8;
    const badBuy = relativeToAvgCost > 0.06 && strategy.disciplineFactor < 0.7;
    return { action, tokenAmount, reason, disciplined, badBuy };
  }

  return { action: "none", tokenAmount: 0, reason, disciplined: true, badBuy: false };
}

export async function initializeTraderOnChain(
  provider: anchor.AnchorProvider,
  program: Program<any>,
  trader: TraderRuntime,
): Promise<void> {
  const keypair = Keypair.generate();
  const [profilePda] = PublicKey.findProgramAddressSync([Buffer.from("acba"), keypair.publicKey.toBuffer()], program.programId);
  const sig = await provider.connection.requestAirdrop(keypair.publicKey, INITIAL_LAMPORTS);
  await confirmWithRetry(provider.connection, sig);

  const methods = program.methods as any;
  const tx = await methods
    .initializeProfile()
    .accountsPartial({
      profile: profilePda,
      owner: keypair.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .transaction();

  const signature = await provider.connection.sendTransaction(tx, [keypair], { skipPreflight: true });
  await confirmWithRetry(provider.connection, signature);

  // Verify the account was created
  try {
    const acbaProfile = (program.account as any).acbaProfile;
    await acbaProfile.fetch(profilePda);
    console.log(`[INIT] Trader ${keypair.publicKey.toBase58().slice(0, 8)}... initialized`);
  } catch (error) {
    throw new Error(`Failed to create trader account. Program may not be deployed on localnet: ${(error as Error).message}`);
  }

  trader.keypair = keypair;
  trader.publicKey = keypair.publicKey;
  trader.profilePda = profilePda;
}

export async function fetchFreshState(
  program: Program<any>,
  trader: TraderRuntime,
): Promise<FreshProfileState> {
  if (!trader.profilePda) {
    return {
      tokenUnitsHeld: 0,
      avgLamportsPerTokenScaled: 0n,
      realizedPnlLamports: 0,
      disciplinedBuyCount: trader.disciplinedBuys,
      buyCount: trader.buys,
    };
  }

  const acbaProfile = (program.account as any).acbaProfile;
  try {
    const state = await acbaProfile.fetch(trader.profilePda);
    return {
      tokenUnitsHeld: state.tokenUnitsHeld.toNumber(),
      avgLamportsPerTokenScaled: BigInt(state.avgLamportsPerTokenScaled.toString()),
      realizedPnlLamports: state.realizedPnlLamports.toNumber(),
      disciplinedBuyCount: state.disciplinedBuyCount.toNumber(),
      buyCount: state.buyCount.toNumber(),
    };
  } catch (error) {
    console.warn(`[WARN] Account fetch failed for trader ${trader.traderId}: ${(error as Error).message}, using default state`);
    return {
      tokenUnitsHeld: 0,
      avgLamportsPerTokenScaled: 0n,
      realizedPnlLamports: 0,
      disciplinedBuyCount: trader.disciplinedBuys,
      buyCount: trader.buys,
    };
  }
}

export async function executeBuy(
  program: Program<any>,
  trader: TraderRuntime,
  tokenAmount: number,
): Promise<void> {
  if (!trader.profilePda || !trader.publicKey || !trader.keypair) throw new Error("missing trader accounts");
  const lamportsIn = new BN(Math.floor(trader.strategy.positionSizeLamports));
  const methods = program.methods as any;
  const tx = await methods
    .recordBuy(lamportsIn, new BN(tokenAmount))
    .accountsPartial({ profile: trader.profilePda, owner: trader.publicKey })
    .transaction();

  const signature = await program.provider.connection.sendTransaction(tx, [trader.keypair], { skipPreflight: true });
  await confirmWithRetry(program.provider.connection, signature);

  trader.lamportsBalance -= lamportsIn.toNumber();
  trader.totalTransactions += 1;
}

export async function executeSell(
  program: Program<any>,
  trader: TraderRuntime,
  tokenAmount: number,
  avgScaled: bigint,
): Promise<void> {
  if (!trader.profilePda || !trader.publicKey || !trader.keypair) throw new Error("missing trader accounts");

  const avg = new BN(avgScaled.toString());
  const proceeds = avg.mul(new BN(tokenAmount)).mul(new BN(103)).div(new BN(100)).div(new BN(SCALE.toString()));

  const methods = program.methods as any;
  const tx = await methods
    .recordSell(proceeds, new BN(tokenAmount))
    .accountsPartial({ profile: trader.profilePda, owner: trader.publicKey })
    .transaction();

  const signature = await program.provider.connection.sendTransaction(tx, [trader.keypair], { skipPreflight: true });
  await confirmWithRetry(program.provider.connection, signature);

  trader.lamportsBalance += proceeds.toNumber();
  trader.totalTransactions += 1;
}