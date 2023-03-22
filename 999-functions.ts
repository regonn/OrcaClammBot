import { PublicKey } from "@solana/web3.js";
import * as dotenv from "dotenv";
import { AnchorProvider, BN } from "@project-serum/anchor";
import {
  PriceMath,
  ORCA_WHIRLPOOLS_CONFIG,
  Whirlpool,
  WhirlpoolClient,
  swapQuoteByInputToken,
  increaseLiquidityQuoteByInputTokenWithParams,
  WhirlpoolContext,
  buildWhirlpoolClient,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PDAUtil,
  PoolUtil,
  WhirlpoolIx,
  decreaseLiquidityQuoteByLiquidityWithParams,
} from "@orca-so/whirlpools-sdk";
import {
  usdc,
  targetToken,
  tickSpacing,
  RPC_ENDPOINT_URL,
  COMMITMENT,
} from "./000-config";
import { Decimal } from "decimal.js";
import { Keypair, Connection } from "@solana/web3.js";
import secret from "./wallet.json";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  TokenUtil,
  Instruction,
  EMPTY_INSTRUCTION,
  deriveATA,
  resolveOrCreateATA,
  TransactionBuilder,
  Percentage,
  DecimalUtil,
} from "@orca-so/common-sdk";

export interface Ohlc {
  mint: string;
  granularity: string;
  lastblockid: number;
  startTime: number;
  high: string;
  low: string;
  open: string;
  close: string;
  volume: string;
}

export interface Position {
  positionAddress: string;
  whirlpoolId: string;
  whirlpoolPrice: string;
  tokenA: string;
  tokenB: string;
  liquidity: string;
  lower: string;
  upper: string;
  amountA: string;
  amountB: string;
}

export interface Balance {
  target: Decimal;
  usdc: Decimal;
}

dotenv.config();

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export function getOrcaClient(): WhirlpoolClient {
  const provider = AnchorProvider.env();
  const ctx = WhirlpoolContext.withProvider(
    provider,
    ORCA_WHIRLPOOL_PROGRAM_ID
  );
  const client = buildWhirlpoolClient(ctx);
  return client;
}

async function getWhirlpool(client: WhirlpoolClient): Promise<Whirlpool> {
  const whirlpool_pubkey = PDAUtil.getWhirlpool(
    ORCA_WHIRLPOOL_PROGRAM_ID,
    ORCA_WHIRLPOOLS_CONFIG,
    targetToken.mint,
    usdc.mint,
    tickSpacing
  ).publicKey;
  const whirlpool = await client.getPool(whirlpool_pubkey);
  return whirlpool;
}

export async function getPrice(): Promise<Decimal> {
  const client = getOrcaClient();
  const whirlpool = await getWhirlpool(client);

  const sqrt_price_x64 = whirlpool.getData().sqrtPrice;
  const price = PriceMath.sqrtPriceX64ToPrice(
    sqrt_price_x64,
    targetToken.decimals,
    usdc.decimals
  );

  console.log("price:", price.toFixed(usdc.decimals));
  return price;
}

export async function getBalance(): Promise<Balance> {
  const connection = new Connection(RPC_ENDPOINT_URL, COMMITMENT);
  const keypair = Keypair.fromSecretKey(new Uint8Array(secret));
  console.log("wallet pubkey:", keypair.publicKey.toBase58());
  const accounts = await connection.getTokenAccountsByOwner(keypair.publicKey, {
    programId: TOKEN_PROGRAM_ID,
  });
  const balance: Balance = { target: new Decimal(0), usdc: new Decimal(0) };
  for (let i = 0; i < accounts.value.length; i++) {
    const value = accounts.value[i];

    const parsed_token_account = TokenUtil.deserializeTokenAccount(
      value.account.data
    );

    if (!parsed_token_account) continue;

    const mint = parsed_token_account.mint;

    if (mint.equals(targetToken.mint)) {
      balance.target = DecimalUtil.fromU64(
        parsed_token_account.amount,
        targetToken.decimals
      );
    } else if (mint.equals(usdc.mint)) {
      balance.usdc = DecimalUtil.fromU64(
        parsed_token_account.amount,
        usdc.decimals
      );
    }
  }

  console.log("balance:", balance);

  return balance;
}

export async function swapInToken(
  token: { mint: PublicKey; decimals: number },
  InAmount: Decimal
) {
  const provider = AnchorProvider.env();
  const ctx = WhirlpoolContext.withProvider(
    provider,
    ORCA_WHIRLPOOL_PROGRAM_ID
  );
  const client = buildWhirlpoolClient(ctx);
  const whirlpool = await getWhirlpool(client);
  const quote = await swapQuoteByInputToken(
    whirlpool,
    token.mint,
    DecimalUtil.toU64(InAmount, token.decimals),
    Percentage.fromFraction(10, 1000), // (10/1000 = 1%)
    ctx.program.programId,
    ctx.fetcher,
    true
  );

  try {
    const swapTx = await whirlpool.swap(quote);
    const signature = await swapTx.buildAndExecute();
    console.log("SwapSignature:", signature);

    const latest_blockhash = await ctx.connection.getLatestBlockhash();
    await ctx.connection.confirmTransaction(
      { signature, ...latest_blockhash },
      "confirmed"
    );
  } catch (e) {
    console.error(e);
    console.log("wait 10 sec");
    await sleep(10000);
  }
}

export async function openPosition(
  lowerPrice: Decimal,
  upperPrice: Decimal,
  targetAmount: Decimal
) {
  const provider = AnchorProvider.env();
  const ctx = WhirlpoolContext.withProvider(
    provider,
    ORCA_WHIRLPOOL_PROGRAM_ID
  );
  const client = buildWhirlpoolClient(ctx);

  const whirlpool = await getWhirlpool(client);

  const sqrt_price_x64 = whirlpool.getData().sqrtPrice;
  const price = PriceMath.sqrtPriceX64ToPrice(
    sqrt_price_x64,
    targetToken.decimals,
    usdc.decimals
  );
  console.log("price:", price.toFixed(usdc.decimals));

  const targetAmountU64 = DecimalUtil.toU64(targetAmount, targetToken.decimals);
  const slippage = Percentage.fromFraction(10, 1000); // 1%

  const whirlpool_data = whirlpool.getData();
  const token_a = whirlpool.getTokenAInfo();
  const token_b = whirlpool.getTokenBInfo();
  const lower_tick_index = PriceMath.priceToInitializableTickIndex(
    lowerPrice,
    token_a.decimals,
    token_b.decimals,
    whirlpool_data.tickSpacing
  );
  const upper_tick_index = PriceMath.priceToInitializableTickIndex(
    upperPrice,
    token_a.decimals,
    token_b.decimals,
    whirlpool_data.tickSpacing
  );
  console.log(
    "lower & upper price",
    PriceMath.tickIndexToPrice(
      lower_tick_index,
      token_a.decimals,
      token_b.decimals
    ).toFixed(token_b.decimals),
    PriceMath.tickIndexToPrice(
      upper_tick_index,
      token_a.decimals,
      token_b.decimals
    ).toFixed(token_b.decimals)
  );

  const quote = increaseLiquidityQuoteByInputTokenWithParams({
    tokenMintA: token_a.mint,
    tokenMintB: token_b.mint,
    sqrtPrice: whirlpool_data.sqrtPrice,
    tickCurrentIndex: whirlpool_data.tickCurrentIndex,

    tickLowerIndex: lower_tick_index,
    tickUpperIndex: upper_tick_index,

    inputTokenMint: targetToken.mint,
    inputTokenAmount: targetAmountU64,

    slippageTolerance: slippage,
  });

  console.log(
    "targetToken max input",
    DecimalUtil.fromU64(quote.tokenMaxA, token_a.decimals).toFixed(
      token_a.decimals
    )
  );
  console.log(
    "USDC max input",
    DecimalUtil.fromU64(quote.tokenMaxB, token_b.decimals).toFixed(
      token_b.decimals
    )
  );

  const open_position_tx = await whirlpool.openPositionWithMetadata(
    lower_tick_index,
    upper_tick_index,
    quote
  );

  try {
    const signature = await open_position_tx.tx.buildAndExecute();
    console.log("OpenPositionSignature", signature);
    console.log("positionNFT:", open_position_tx.positionMint.toBase58());

    const latest_blockhash = await ctx.connection.getLatestBlockhash();
    await ctx.connection.confirmTransaction(
      { signature, ...latest_blockhash },
      "confirmed"
    );
  } catch (e) {
    console.log("error", e);
    console.log("wait 10 sec");
    await sleep(10000);
  }
}

export async function closePosition(position_address: string) {
  const provider = AnchorProvider.env();
  const ctx = WhirlpoolContext.withProvider(
    provider,
    ORCA_WHIRLPOOL_PROGRAM_ID
  );
  const client = buildWhirlpoolClient(ctx);

  const position_pubkey = new PublicKey(position_address);
  console.log("closePositionAddress:", position_pubkey.toBase58());

  const slippage = Percentage.fromFraction(10, 1000); // 1%

  const position = await client.getPosition(position_pubkey);
  const position_owner = ctx.wallet.publicKey;
  const position_token_account = await deriveATA(
    position_owner,
    position.getData().positionMint
  );
  const whirlpool_pubkey = position.getData().whirlpool;
  const whirlpool = await client.getPool(whirlpool_pubkey);
  const whirlpool_data = whirlpool.getData();

  const token_a = whirlpool.getTokenAInfo();
  const token_b = whirlpool.getTokenBInfo();

  const tick_spacing = whirlpool.getData().tickSpacing;
  const tick_array_lower_pubkey = PDAUtil.getTickArrayFromTickIndex(
    position.getData().tickLowerIndex,
    tick_spacing,
    whirlpool_pubkey,
    ctx.program.programId
  ).publicKey;
  const tick_array_upper_pubkey = PDAUtil.getTickArrayFromTickIndex(
    position.getData().tickUpperIndex,
    tick_spacing,
    whirlpool_pubkey,
    ctx.program.programId
  ).publicKey;

  const tokens_to_be_collected = new Set<string>();
  tokens_to_be_collected.add(token_a.mint.toBase58());
  tokens_to_be_collected.add(token_b.mint.toBase58());
  whirlpool.getData().rewardInfos.map((reward_info) => {
    if (PoolUtil.isRewardInitialized(reward_info)) {
      tokens_to_be_collected.add(reward_info.mint.toBase58());
    }
  });

  const required_ta_ix: Instruction[] = [];
  const token_account_map = new Map<string, PublicKey>();
  for (let mint_b58 of tokens_to_be_collected) {
    const mint = new PublicKey(mint_b58);

    const { address, ...ix } = await resolveOrCreateATA(
      ctx.connection,
      position_owner,
      mint,
      () => ctx.fetcher.getAccountRentExempt()
    );
    required_ta_ix.push(ix);
    token_account_map.set(mint_b58, address);
  }

  let update_fee_and_rewards_ix = WhirlpoolIx.updateFeesAndRewardsIx(
    ctx.program,
    {
      whirlpool: position.getData().whirlpool,
      position: position_pubkey,
      tickArrayLower: tick_array_lower_pubkey,
      tickArrayUpper: tick_array_upper_pubkey,
    }
  );

  let collect_fees_ix = WhirlpoolIx.collectFeesIx(ctx.program, {
    whirlpool: whirlpool_pubkey,
    position: position_pubkey,
    positionAuthority: position_owner,
    positionTokenAccount: position_token_account,
    tokenOwnerAccountA: token_account_map.get(
      token_a.mint.toBase58()
    ) as PublicKey,
    tokenOwnerAccountB: token_account_map.get(
      token_b.mint.toBase58()
    ) as PublicKey,
    tokenVaultA: whirlpool.getData().tokenVaultA,
    tokenVaultB: whirlpool.getData().tokenVaultB,
  });

  const collect_reward_ix = [
    EMPTY_INSTRUCTION,
    EMPTY_INSTRUCTION,
    EMPTY_INSTRUCTION,
  ];
  for (let i = 0; i < whirlpool.getData().rewardInfos.length; i++) {
    const reward_info = whirlpool.getData().rewardInfos[i];
    if (!PoolUtil.isRewardInitialized(reward_info)) continue;

    collect_reward_ix[i] = WhirlpoolIx.collectRewardIx(ctx.program, {
      whirlpool: whirlpool_pubkey,
      position: position_pubkey,
      positionAuthority: position_owner,
      positionTokenAccount: position_token_account,
      rewardIndex: i,
      rewardOwnerAccount: token_account_map.get(
        reward_info.mint.toBase58()
      ) as PublicKey,
      rewardVault: reward_info.vault,
    });
  }

  const quote = decreaseLiquidityQuoteByLiquidityWithParams({
    sqrtPrice: whirlpool_data.sqrtPrice,
    tickCurrentIndex: whirlpool_data.tickCurrentIndex,

    tickLowerIndex: position.getData().tickLowerIndex,
    tickUpperIndex: position.getData().tickUpperIndex,

    liquidity: position.getData().liquidity,

    slippageTolerance: slippage,
  });

  console.log(
    "targetToken min output",
    DecimalUtil.fromU64(quote.tokenMinA, token_a.decimals).toFixed(
      token_a.decimals
    )
  );
  console.log(
    "USDC min output",
    DecimalUtil.fromU64(quote.tokenMinB, token_b.decimals).toFixed(
      token_b.decimals
    )
  );

  const decrease_liquidity_ix = WhirlpoolIx.decreaseLiquidityIx(ctx.program, {
    ...quote,
    whirlpool: whirlpool_pubkey,
    position: position_pubkey,
    positionAuthority: position_owner,
    positionTokenAccount: position_token_account,
    tokenOwnerAccountA: token_account_map.get(
      token_a.mint.toBase58()
    ) as PublicKey,
    tokenOwnerAccountB: token_account_map.get(
      token_b.mint.toBase58()
    ) as PublicKey,
    tokenVaultA: whirlpool.getData().tokenVaultA,
    tokenVaultB: whirlpool.getData().tokenVaultB,
    tickArrayLower: tick_array_lower_pubkey,
    tickArrayUpper: tick_array_upper_pubkey,
  });

  const close_position_ix = WhirlpoolIx.closePositionIx(ctx.program, {
    position: position_pubkey,
    positionAuthority: position_owner,
    positionTokenAccount: position_token_account,
    positionMint: position.getData().positionMint,
    receiver: position_owner,
  });

  const tx_builder = new TransactionBuilder(ctx.connection, ctx.wallet);

  required_ta_ix.map((ix) => tx_builder.addInstruction(ix));
  tx_builder

    .addInstruction(update_fee_and_rewards_ix)
    .addInstruction(collect_fees_ix)
    .addInstruction(collect_reward_ix[0])
    .addInstruction(collect_reward_ix[1])
    .addInstruction(collect_reward_ix[2])

    .addInstruction(decrease_liquidity_ix)

    .addInstruction(close_position_ix);

  try {
    const signature = await tx_builder.buildAndExecute();
    console.log("ClosePositionSignature", signature);
    const latest_blockhash = await ctx.connection.getLatestBlockhash();
    await ctx.connection.confirmTransaction(
      { signature, ...latest_blockhash },
      "confirmed"
    );
  } catch (e) {
    console.log("error", e);
    console.log("wait 10 sec");
    await sleep(10000);
  }
}

export async function getPositions(): Promise<Position[]> {
  const provider = AnchorProvider.env();
  const ctx = WhirlpoolContext.withProvider(
    provider,
    ORCA_WHIRLPOOL_PROGRAM_ID
  );
  const client = buildWhirlpoolClient(ctx);

  const token_accounts = (
    await ctx.connection.getTokenAccountsByOwner(ctx.wallet.publicKey, {
      programId: TOKEN_PROGRAM_ID,
    })
  ).value;

  const whirlpool_position_candidate_pubkeys: PublicKey[] = token_accounts
    .map((ta) => {
      const parsed = TokenUtil.deserializeTokenAccount(ta.account.data);

      if (!parsed) return undefined;

      const pda = PDAUtil.getPosition(ctx.program.programId, parsed.mint);

      return new BN(parsed.amount.toString()).eq(new BN(1))
        ? pda.publicKey
        : undefined;
    })
    .filter((pubkey) => pubkey !== undefined) as PublicKey[];

  const whirlpool_position_candidate_datas = await ctx.fetcher.listPositions(
    whirlpool_position_candidate_pubkeys,
    true
  );

  const whirlpool_positions = whirlpool_position_candidate_pubkeys.filter(
    (pubkey, i) => whirlpool_position_candidate_datas[i] !== null
  );

  const positions: Position[] = [];

  for (let i = 0; i < whirlpool_positions.length; i++) {
    const p = whirlpool_positions[i];

    const position = await client.getPosition(p);
    const data = position.getData();

    const pool = await client.getPool(data.whirlpool);
    const token_a = pool.getTokenAInfo();
    const token_b = pool.getTokenBInfo();
    const price = PriceMath.sqrtPriceX64ToPrice(
      pool.getData().sqrtPrice,
      token_a.decimals,
      token_b.decimals
    );

    const lower_price = PriceMath.tickIndexToPrice(
      data.tickLowerIndex,
      token_a.decimals,
      token_b.decimals
    );
    const upper_price = PriceMath.tickIndexToPrice(
      data.tickUpperIndex,
      token_a.decimals,
      token_b.decimals
    );

    const amounts = PoolUtil.getTokenAmountsFromLiquidity(
      data.liquidity,
      pool.getData().sqrtPrice,
      PriceMath.tickIndexToSqrtPriceX64(data.tickLowerIndex),
      PriceMath.tickIndexToSqrtPriceX64(data.tickUpperIndex),
      true
    );

    positions.push({
      positionAddress: p.toBase58(),
      whirlpoolId: data.whirlpool.toBase58(),
      whirlpoolPrice: price.toFixed(token_b.decimals),
      tokenA: token_a.mint.toBase58(),
      tokenB: token_b.mint.toBase58(),
      liquidity: data.liquidity.toString(),
      lower: lower_price.toFixed(token_b.decimals),
      upper: upper_price.toFixed(token_b.decimals),
      amountA: DecimalUtil.fromU64(amounts.tokenA, token_a.decimals).toString(),
      amountB: DecimalUtil.fromU64(amounts.tokenB, token_b.decimals).toString(),
    });
  }
  return positions;
}
