import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import assert from "assert";
import BN from "bn.js";

describe("baby_anchor (ACBA profile)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BabyAnchor as Program<any>;
  const acbaAccount = (program.account as any).acbaProfile;

  it("initialize -> record_buy twice -> verify totals + average", async () => {
const newUser = anchor.web3.Keypair.generate();
const owner = newUser.publicKey;

const sig = await provider.connection.requestAirdrop(
  owner,
  2 * anchor.web3.LAMPORTS_PER_SOL
);
await provider.connection.confirmTransaction(sig, "confirmed");

const [profilePda] = PublicKey.findProgramAddressSync(
  [Buffer.from("acba"), owner.toBuffer()],
  program.programId
);

await (program as any).methods
  .initializeProfile()
  .accountsPartial({
    profile: profilePda,
    owner,
    systemProgram: anchor.web3.SystemProgram.programId,
  })
  .signers([newUser])
  .rpc();

    // Buy 1
    await (program as any).methods
      .recordBuy(new BN(500_000_000), new BN(10))
      .accounts({ profile: profilePda, owner })
      .signers([newUser])
      .rpc();

    // Buy 2
    await (program as any).methods
      .recordBuy(new BN(400_000_000), new BN(10))
      .accounts({ profile: profilePda, owner })
      .signers([newUser])
      .rpc();


    const acct = await acbaAccount.fetch(profilePda);

    console.log("Final:", {
      owner: acct.owner.toBase58(),
      totalLamportsIn: acct.totalLamportsIn.toString(),
      totalTokenUnitsOut: acct.totalTokenUnitsOut.toString(),
      avgLamportsPerTokenScaled: acct.avgLamportsPerTokenScaled.toString(),
      lastUpdateTs: acct.lastUpdateTs.toString(),
      disciplinedBuyCount: acct.disciplinedBuyCount.toString(),
      buyCount: acct.buyCount.toString(),
      lastImprovementBps: acct.lastImprovementBps.toString(),
    });

    console.log("lastWasDisciplined:", acct.lastWasDisciplined);

    assert.equal(acct.owner.toBase58(), owner.toBase58());
    assert.equal(acct.totalLamportsIn.toNumber(), 900_000_000);
    assert.equal(acct.totalTokenUnitsOut.toNumber(), 20);

    // avg = totalLamports * SCALE / totalTokens
    // SCALE = 1_000_000_000
    // 900_000_000 * 1_000_000_000 / 20 = 45_000_000_000_000_000
    assert.equal(acct.avgLamportsPerTokenScaled.toString(), "45000000000000000");

    console.log("lastWasDisciplined:", acct.lastWasDisciplined);

    assert.equal(acct.lastWasDisciplined, true);
    assert.equal(acct.disciplinedBuyCount.toNumber(), 1);
    assert.equal(acct.buyCount.toNumber(), 2);
    assert.equal(acct.lastImprovementBps.toNumber(), 2000); // 20k bps = 20% improvement from 50 to 40
  });

  it("initialize -> bad second buy -> verify discipline", async () => {
    const newUser = anchor.web3.Keypair.generate();
    const owner = newUser.publicKey;

    const sig = await provider.connection.requestAirdrop(
        owner,
        2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig, "confirmed");

    const [profilePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("acba"), owner.toBuffer()],
      program.programId
    );

    // Initialize profile PDA
    await (program as any).methods
      .initializeProfile()
      .accountsPartial({
        profile: profilePda,
        owner: owner,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([newUser])
      .rpc();

    // Buy 1
    await (program as any).methods
      .recordBuy(new BN(500_000_000), new BN(10))
      .accounts({ profile: profilePda, owner })
      .signers([newUser])
      .rpc();

    // Buy 2 (bad buy: higher price)
    await (program as any).methods
      .recordBuy(new BN(700_000_000), new BN(10))
      .accounts({ profile: profilePda, owner })
      .signers([newUser])
      .rpc();

    const acct = await acbaAccount.fetch(profilePda);

    console.log("Final bad buy:", {
      owner: acct.owner.toBase58(),
      totalLamportsIn: acct.totalLamportsIn.toString(),
      totalTokenUnitsOut: acct.totalTokenUnitsOut.toString(),
      avgLamportsPerTokenScaled: acct.avgLamportsPerTokenScaled.toString(),
      lastUpdateTs: acct.lastUpdateTs.toString(),
      disciplinedBuyCount: acct.disciplinedBuyCount.toString(),
      buyCount: acct.buyCount.toString(),
      lastImprovementBps: acct.lastImprovementBps.toString(),
    });

    console.log("lastWasDisciplined:", acct.lastWasDisciplined);

    assert.equal(acct.lastWasDisciplined, false);
    assert.equal(acct.disciplinedBuyCount.toNumber(), 0);
    assert.equal(acct.buyCount.toNumber(), 2);
    assert.equal(acct.lastImprovementBps.toNumber(), -4000);
  });
});