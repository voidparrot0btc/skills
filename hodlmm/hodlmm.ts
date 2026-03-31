#!/usr/bin/env bun
import { program } from "commander";
import {
  makeContractCall,
  broadcastTransaction,
  uintCV,
  intCV,
  listCV,
  tupleCV,
  noneCV,
  contractPrincipalCV,
  makeStandardFungiblePostCondition,
  makeContractFungiblePostCondition,
  FungibleConditionCode,
  PostConditionMode,
  AnchorMode,
} from "@stacks/transactions";
import { StacksMainnet } from "@stacks/network";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// ── Config ────────────────────────────────────────────────────────────────────
const BFF_BASE = "https://bff.bitflowapis.finance";
const API_KEY = process.env.HODLMM_API_KEY || "";
const LIQUIDITY_ROUTER = "SP3ESW1QCNQPVXJDGQWT7E45RDCH38QBK9HEJSX4X.dlmm-liquidity-router-v-0-1";
const PRICE_SCALE_BPS = 1e8;
const FEE_SCALE_BPS = 1e4;
const network = new StacksMainnet();

function out(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

function err(msg: string, extra?: object): never {
  console.log(JSON.stringify({ error: msg, ...extra }, null, 2));
  process.exit(1);
}

function headers() {
  return {
    "Content-Type": "application/json",
    ...(API_KEY ? { "X-API-Key": API_KEY } : {}),
  };
}

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${BFF_BASE}${path}`, {
    ...options,
    headers: { ...headers(), ...(options?.headers || {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${path}`);
  return res.json();
}

// ── Wallet helpers ─────────────────────────────────────────────────────────────
function loadWallet() {
  const configPath = join(homedir(), ".aibtc", "config.json");
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const walletName = config.activeWallet;
    if (!walletName) err("No active wallet. Run: bun run wallet/wallet.ts unlock");
    const walletPath = join(homedir(), ".aibtc", "wallets", `${walletName}.json`);
    const wallet = JSON.parse(readFileSync(walletPath, "utf-8"));
    if (!wallet.privateKey) err("Wallet locked. Run: bun run wallet/wallet.ts unlock --password <password>");
    return wallet;
  } catch (e: any) {
    err(`Could not load wallet: ${e.message}`);
  }
}

function getSignedBinId(unsigned: number) {
  return unsigned - 500;
}

// ── Typed interfaces ───────────────────────────────────────────────────────────
interface BinState {
  is_active_bin: boolean;
  bin_price: number;
  reserve_x: number;
  reserve_y: number;
  bin_shares: number;
  x_amount: number;
  y_amount: number;
}

interface PoolFees {
  x_protocol_fee: number;
  x_provider_fee: number;
  x_variable_fee: number;
  y_protocol_fee: number;
  y_provider_fee: number;
  y_variable_fee: number;
}

// ── DLP calculation ────────────────────────────────────────────────────────────
function calcMinDlp(bin: BinState, poolFees: PoolFees, slippage = 1) {
  const { is_active_bin, bin_price, reserve_x, reserve_y, bin_shares, x_amount, y_amount } = bin;
  const { x_protocol_fee, x_provider_fee, x_variable_fee,
          y_protocol_fee, y_provider_fee, y_variable_fee } = poolFees;
  const MIN_SHARES = 10000;
  const MIN_BURNT = 1000;

  const addValue = bin_price * x_amount + y_amount * PRICE_SCALE_BPS;
  const binValue = bin_price * reserve_x + reserve_y * PRICE_SCALE_BPS;
  const dlp = bin_shares === 0 || binValue === 0 ? Math.sqrt(addValue) : (addValue * bin_shares) / binValue;

  let xFeeL = 0, yFeeL = 0;
  if (is_active_bin && dlp > 0) {
    const xFee = x_protocol_fee + x_provider_fee + x_variable_fee;
    const yFee = y_protocol_fee + y_provider_fee + y_variable_fee;
    const xW = (dlp * (reserve_x + x_amount)) / (bin_shares + dlp);
    const yW = (dlp * (reserve_y + y_amount)) / (bin_shares + dlp);
    if (yW > y_amount && x_amount > xW) xFeeL = Math.min(x_amount, ((x_amount - xW) * xFee) / FEE_SCALE_BPS);
    if (xW > x_amount && y_amount > yW) yFeeL = Math.min(y_amount, ((y_amount - yW) * yFee) / FEE_SCALE_BPS);
  }

  const xPost = x_amount - xFeeL;
  const yPost = y_amount - yFeeL;
  const rxPost = reserve_x + xFeeL;
  const ryPost = (reserve_y + yFeeL) * PRICE_SCALE_BPS;
  const addPost = bin_price * xPost + yPost * PRICE_SCALE_BPS;
  const binPost = bin_price * rxPost + ryPost;

  let dlpPost: number;
  if (bin_shares === 0) {
    const intended = Math.sqrt(addPost);
    dlpPost = intended >= MIN_SHARES ? intended - MIN_BURNT : 0;
  } else if (binPost === 0) {
    dlpPost = Math.sqrt(addPost);
  } else {
    dlpPost = (addPost * bin_shares) / binPost;
  }

  return {
    min_dlp: Math.floor(dlpPost * (1 - slippage / 100)),
    x_fee: Math.ceil(xFeeL),
    y_fee: Math.ceil(yFeeL),
  };
}

// ── Commands ───────────────────────────────────────────────────────────────────
program.name("hodlmm").description("Bitflow HODLMM concentrated liquidity skill");

// pools
program.command("pools").description("List all available HODLMM pools").action(async () => {
  try {
    const data = await apiFetch("/api/quotes/v1/pools");
    out({ success: true, ...data });
  } catch (e: any) { err(e.message); }
});

// pool
program.command("pool <pool_id>").description("Get full pool data").action(async (pool_id) => {
  try {
    const data = await apiFetch(`/api/app/v1/pools/${pool_id}`);
    out({ success: true, pool_id, ...data });
  } catch (e: any) { err(e.message, { pool_id }); }
});

// pairs
program.command("pairs").description("List all trading pairs").action(async () => {
  try {
    const data = await apiFetch("/api/quotes/v1/pairs");
    out({ success: true, ...data });
  } catch (e: any) { err(e.message); }
});

// tokens
program.command("tokens").description("List all available tokens").action(async () => {
  try {
    const data = await apiFetch("/api/quotes/v1/tokens");
    out({ success: true, ...data });
  } catch (e: any) { err(e.message); }
});

// bins
program.command("bins <pool_id>").description("Get all bins for a pool").action(async (pool_id) => {
  try {
    const data = await apiFetch(`/api/quotes/v1/bins/${pool_id}`);
    out({ success: true, pool_id, active_bin: data.active_bin_id, bin_count: data.bins?.length || 0, data });
  } catch (e: any) { err(e.message, { pool_id }); }
});

// bin-price-history
program.command("bin-price-history <pool_id>").description("Get bin price history").action(async (pool_id) => {
  try {
    const data = await apiFetch(`/api/app/v1/pools/${pool_id}/bin-price-history`);
    out({ success: true, pool_id, data });
  } catch (e: any) { err(e.message, { pool_id }); }
});

// position
program.command("position <pool_id>")
  .option("--address <address>", "Stacks address (defaults to active wallet)")
  .description("Get user liquidity position for a pool")
  .action(async (pool_id, opts) => {
    try {
      const address = opts.address || loadWallet().stacksAddress;
      const data = await apiFetch(`/api/app/v1/users/${address}/liquidity/${pool_id}`);
      out({ success: true, pool_id, address, data });
    } catch (e: any) { err(e.message, { pool_id }); }
  });

// position-bins
program.command("position-bins <pool_id>")
  .option("--address <address>", "Stacks address (defaults to active wallet)")
  .description("Get user position bins for a pool")
  .action(async (pool_id, opts) => {
    try {
      const address = opts.address || loadWallet().stacksAddress;
      const data = await apiFetch(`/api/app/v1/users/${address}/positions/${pool_id}/bins`);
      out({ success: true, pool_id, address, data });
    } catch (e: any) { err(e.message, { pool_id }); }
  });

// quote
program.command("quote <input_token> <output_token> <amount>")
  .option("--slippage <slippage>", "Slippage tolerance %", "1")
  .description("Get swap quote")
  .action(async (input_token, output_token, amount, opts) => {
    try {
      const data = await apiFetch("/api/quotes/v1/quote/multi", {
        method: "POST",
        body: JSON.stringify({
          input_token, output_token,
          amount_in: parseInt(amount),
          amm_strategy: "best",
          slippage_tolerance: parseFloat(opts.slippage),
        }),
      });
      out({ success: true, input_token, output_token, amount_in: amount, data });
    } catch (e: any) { err(e.message); }
  });

// health
program.command("health").description("Check HODLMM API health").action(async () => {
  try {
    const data = await apiFetch("/api/validation/health");
    out({ success: true, data });
  } catch (e: any) { err(e.message); }
});

// monitor
program.command("monitor <pool_id>")
  .option("--address <address>", "Stacks address (defaults to active wallet)")
  .option("--range <bins>", "Dead bin threshold — bins away from active before flagging", "5")
  .description("Monitor LP position health — returns hold | rebalance | check signal")
  .action(async (pool_id, opts) => {
    try {
      const address = opts.address || loadWallet().stacksAddress;
      const deadThreshold = parseInt(opts.range);

      const [poolData, poolBins, userPositions] = await Promise.all([
        apiFetch(`/api/app/v1/pools/${pool_id}`),
        apiFetch(`/api/quotes/v1/bins/${pool_id}`),
        apiFetch(`/api/app/v1/users/${address}/positions/${pool_id}/bins`).catch(() => ({ bins: [] })),
      ]);

      const activeBin: number = poolData.active_bin_id;
      const binsWithLiq = (userPositions.bins || []).filter((b: any) => b.user_liquidity > 0);

      if (binsWithLiq.length === 0) {
        out({ success: true, pool_id, address, verdict: "no_position", message: "No active liquidity found in this pool." });
        return;
      }

      const inRange: any[] = [];
      const deadBins: any[] = [];

      for (const bin of binsWithLiq) {
        const distance = Math.abs(bin.bin_id - activeBin);
        const poolBin = poolBins.bins.find((b: any) => b.bin_id === bin.bin_id);
        const entry = {
          bin_id: bin.bin_id,
          distance_from_active: distance,
          user_liquidity: bin.user_liquidity,
          reserve_x: Number(poolBin?.reserve_x ?? 0),
          reserve_y: Number(poolBin?.reserve_y ?? 0),
          earning: distance <= deadThreshold,
          side: bin.bin_id < activeBin ? "below (y-only)" : bin.bin_id > activeBin ? "above (x-only)" : "active",
        };
        if (distance <= deadThreshold) inRange.push(entry);
        else deadBins.push(entry);
      }

      const totalLiq = binsWithLiq.reduce((s: number, b: any) => s + b.user_liquidity, 0);
      const deadLiq = deadBins.reduce((s: number, b: any) => s + b.user_liquidity, 0);
      const deadPct = Math.round((deadLiq / totalLiq) * 100);

      let verdict: string;
      let message: string;
      if (deadBins.length === 0) {
        verdict = "hold";
        message = `All ${inRange.length} bin(s) within ${deadThreshold} of active bin ${activeBin}. Yield is flowing.`;
      } else if (deadPct >= 50) {
        verdict = "rebalance";
        message = `${deadPct}% of liquidity in dead bins (>${deadThreshold} from active bin ${activeBin}). Move to active range to resume earning.`;
      } else {
        verdict = "check";
        message = `${deadBins.length} dead bin(s) detected (${deadPct}% of liquidity). Monitor or rebalance if active bin continues moving.`;
      }

      out({
        success: true, pool_id, address, verdict, message,
        active_bin: activeBin, dead_threshold: deadThreshold,
        summary: { total_bins: binsWithLiq.length, in_range_bins: inRange.length, dead_bins: deadBins.length, dead_liquidity_pct: deadPct },
        in_range: inRange, dead: deadBins,
      });
    } catch (e: any) { err(e.message, { pool_id }); }
  });

// add-liquidity
program.command("add-liquidity <pool_id> <bin_id> <x_amount> <y_amount>")
  .option("--slippage <slippage>", "Slippage tolerance %", "1")
  .option("--fee <fee>", "Transaction fee in microSTX", "25000")
  .description("Add liquidity to a bin (simple/relative mode)")
  .action(async (pool_id, bin_id_str, x_amount_str, y_amount_str, opts) => {
    try {
      const wallet = loadWallet();
      const bin_id = parseInt(bin_id_str);
      const x_amount = parseInt(x_amount_str);
      const y_amount = parseInt(y_amount_str);
      const slippage = parseFloat(opts.slippage);
      const fee = parseInt(opts.fee);

      const [poolData, poolBins, userPositions] = await Promise.all([
        apiFetch(`/api/app/v1/pools/${pool_id}`),
        apiFetch(`/api/quotes/v1/bins/${pool_id}`),
        apiFetch(`/api/app/v1/users/${wallet.stacksAddress}/positions/${pool_id}/bins`).catch(() => ({ bins: [] })),
      ]);

      const active_bin_id = poolData.active_bin_id;
      const offset = bin_id - active_bin_id;
      const pool_bin = poolBins.bins.find((b: any) => b.bin_id === bin_id);
      if (!pool_bin) err(`Bin ${bin_id} not found in pool`, { pool_id });

      const bin: BinState = {
        is_active_bin: bin_id === active_bin_id,
        bin_price: Number(pool_bin.price),
        reserve_x: Number(pool_bin.reserve_x),
        reserve_y: Number(pool_bin.reserve_y),
        bin_shares: Number(pool_bin.liquidity ?? 0),
        x_amount,
        y_amount,
      };

      const poolFees: PoolFees = {
        x_protocol_fee: poolData.x_protocol_fee || 0,
        x_provider_fee: poolData.x_provider_fee || 0,
        x_variable_fee: poolData.x_variable_fee || 0,
        y_protocol_fee: poolData.y_protocol_fee || 0,
        y_provider_fee: poolData.y_provider_fee || 0,
        y_variable_fee: poolData.y_variable_fee || 0,
      };

      const { min_dlp, x_fee, y_fee } = calcMinDlp(bin, poolFees, slippage);
      const maxXFee = Math.ceil(x_fee * (1 + slippage / 100));
      const maxYFee = Math.ceil(y_fee * (1 + slippage / 100));

      const [routerAddr, routerName] = LIQUIDITY_ROUTER.split(".");
      const [poolAddr, poolName] = pool_id.split(".");
      const [xAddr, xName] = poolData.x_token.split(".");
      const [yAddr, yName] = poolData.y_token.split(".");
      const xAsset = poolData.x_token_asset_name || xName;
      const yAsset = poolData.y_token_asset_name || yName;

      const binPos = tupleCV({
        "active-bin-id-offset": intCV(offset),
        "x-amount": uintCV(x_amount),
        "y-amount": uintCV(y_amount),
        "min-dlp": uintCV(min_dlp),
        "max-x-liquidity-fee": uintCV(maxXFee),
        "max-y-liquidity-fee": uintCV(maxYFee),
      });

      const tx = await makeContractCall({
        contractAddress: routerAddr,
        contractName: routerName,
        functionName: "add-relative-liquidity-same-multi",
        functionArgs: [
          listCV([binPos]),
          contractPrincipalCV(poolAddr, poolName),
          contractPrincipalCV(xAddr, xName),
          contractPrincipalCV(yAddr, yName),
          noneCV(),
        ],
        senderKey: wallet.privateKey,
        network,
        fee,
        postConditions: [
          makeStandardFungiblePostCondition(
            wallet.stacksAddress, FungibleConditionCode.LessEqual, BigInt(x_amount),
            { address: xAddr, contractName: xName, assetName: xAsset }
          ),
          makeStandardFungiblePostCondition(
            wallet.stacksAddress, FungibleConditionCode.LessEqual, BigInt(y_amount),
            { address: yAddr, contractName: yName, assetName: yAsset }
          ),
        ],
        postConditionMode: PostConditionMode.Deny,
        anchorMode: AnchorMode.Any,
      });

      const result = await broadcastTransaction(tx, network);
      out({ success: true, txid: result.txid, pool_id, bin_id, x_amount, y_amount, min_dlp });
    } catch (e: any) { err(e.message, { pool_id }); }
  });

// withdraw-liquidity
program.command("withdraw-liquidity <pool_id> <percentage>")
  .option("--slippage <slippage>", "Slippage tolerance %", "1")
  .option("--fee <fee>", "Transaction fee in microSTX", "25000")
  .description("Withdraw percentage of all position bins (simple mode)")
  .action(async (pool_id, pct_str, opts) => {
    try {
      const wallet = loadWallet();
      const pct = parseFloat(pct_str);
      const slippage = parseFloat(opts.slippage);
      const fee = parseInt(opts.fee);
      if (pct <= 0 || pct > 100) err("Percentage must be between 1 and 100");

      const [poolData, userPositions] = await Promise.all([
        apiFetch(`/api/app/v1/pools/${pool_id}`),
        apiFetch(`/api/app/v1/users/${wallet.stacksAddress}/positions/${pool_id}/bins`),
      ]);

      const activeBin = poolData.active_bin_id;
      const binsWithLiq = (userPositions.bins || []).filter((b: any) => b.user_liquidity > 0);
      if (binsWithLiq.length === 0) err("No liquidity positions found", { pool_id });

      const [routerAddr, routerName] = LIQUIDITY_ROUTER.split(".");
      const [poolAddr, poolName] = pool_id.split(".");
      const [xAddr, xName] = poolData.x_token.split(".");
      const [yAddr, yName] = poolData.y_token.split(".");
      const xAsset = poolData.x_token_asset_name || xName;
      const yAsset = poolData.y_token_asset_name || yName;

      let totalMinX = 0, totalMinY = 0;
      const positions = binsWithLiq.map((bin: any) => {
        const liqToRemove = Math.floor(bin.user_liquidity * (pct / 100));
        const pctOfBin = liqToRemove / bin.liquidity;
        const slip = 1 - slippage / 100;
        const minX = Math.floor(bin.reserve_x * pctOfBin * slip);
        const minY = Math.floor(bin.reserve_y * pctOfBin * slip);
        totalMinX += minX;
        totalMinY += minY;
        return tupleCV({
          "pool-trait": contractPrincipalCV(poolAddr, poolName),
          "active-bin-id-offset": intCV(bin.bin_id - activeBin),
          "amount": uintCV(liqToRemove),
          "min-x-amount": uintCV(minX),
          "min-y-amount": uintCV(minY),
        });
      });

      const tx = await makeContractCall({
        contractAddress: routerAddr,
        contractName: routerName,
        functionName: "withdraw-relative-liquidity-same-multi",
        functionArgs: [
          listCV(positions),
          contractPrincipalCV(xAddr, xName),
          contractPrincipalCV(yAddr, yName),
          uintCV(totalMinX),
          uintCV(totalMinY),
        ],
        senderKey: wallet.privateKey,
        network,
        fee,
        postConditions: [
          makeContractFungiblePostCondition(
            poolAddr, poolName, FungibleConditionCode.GreaterEqual, BigInt(totalMinX),
            { address: xAddr, contractName: xName, assetName: xAsset }
          ),
          makeContractFungiblePostCondition(
            poolAddr, poolName, FungibleConditionCode.GreaterEqual, BigInt(totalMinY),
            { address: yAddr, contractName: yName, assetName: yAsset }
          ),
        ],
        postConditionMode: PostConditionMode.Deny,
        anchorMode: AnchorMode.Any,
      });

      const result = await broadcastTransaction(tx, network);
      out({ success: true, txid: result.txid, pool_id, percentage: pct, bins_withdrawn: binsWithLiq.length });
    } catch (e: any) { err(e.message, { pool_id }); }
  });

// move-liquidity
program.command("move-liquidity <pool_id> <from_bin_id> <to_bin_offset> <amount>")
  .option("--slippage <slippage>", "Slippage tolerance %", "1")
  .option("--fee <fee>", "Transaction fee in microSTX", "25000")
  .description("Move liquidity from a bin to offset relative to active bin")
  .action(async (pool_id, from_str, offset_str, amount_str, opts) => {
    try {
      const wallet = loadWallet();
      const from_bin_id = parseInt(from_str);
      const to_offset = parseInt(offset_str);
      const amount = parseInt(amount_str);
      const slippage = parseFloat(opts.slippage);
      const fee = parseInt(opts.fee);

      const [poolData, poolBins, userPositions] = await Promise.all([
        apiFetch(`/api/app/v1/pools/${pool_id}`),
        apiFetch(`/api/quotes/v1/bins/${pool_id}`),
        apiFetch(`/api/app/v1/users/${wallet.stacksAddress}/positions/${pool_id}/bins`),
      ]);

      const activeBin = poolData.active_bin_id;
      const toBinId = activeBin + to_offset;
      const fromBin = (userPositions.bins || []).find((b: any) => b.bin_id === from_bin_id);
      if (!fromBin) err(`No position in from_bin ${from_bin_id}`, { pool_id });
      if (fromBin.user_liquidity === 0) err("No liquidity in from_bin");
      if (amount > fromBin.user_liquidity) err("Amount exceeds user liquidity");

      const toBin = poolBins.bins.find((b: any) => b.bin_id === toBinId);
      if (!toBin) err(`to_bin ${toBinId} (active+${to_offset}) not found in pool`);

      const xAmt = Math.floor((amount * fromBin.reserve_x) / fromBin.liquidity);
      const yAmt = Math.floor((amount * fromBin.reserve_y) / fromBin.liquidity);

      const moveBin: BinState = {
        is_active_bin: toBinId === activeBin,
        bin_price: Number(toBin.price),
        reserve_x: Number(toBin.reserve_x),
        reserve_y: Number(toBin.reserve_y),
        bin_shares: Number(toBin.liquidity ?? 0),
        x_amount: xAmt,
        y_amount: yAmt,
      };

      const poolFees: PoolFees = {
        x_protocol_fee: poolData.x_protocol_fee || 0,
        x_provider_fee: poolData.x_provider_fee || 0,
        x_variable_fee: poolData.x_variable_fee || 0,
        y_protocol_fee: poolData.y_protocol_fee || 0,
        y_provider_fee: poolData.y_provider_fee || 0,
        y_variable_fee: poolData.y_variable_fee || 0,
      };

      const { min_dlp, x_fee, y_fee } = calcMinDlp(moveBin, poolFees, slippage);
      const maxXFee = Math.ceil(x_fee * (1 + slippage / 100));
      const maxYFee = Math.ceil(y_fee * (1 + slippage / 100));

      const [routerAddr, routerName] = LIQUIDITY_ROUTER.split(".");
      const [poolAddr, poolName] = pool_id.split(".");
      const [xAddr, xName] = poolData.x_token.split(".");
      const [yAddr, yName] = poolData.y_token.split(".");

      const movePos = tupleCV({
        "pool-trait": contractPrincipalCV(poolAddr, poolName),
        "x-token-trait": contractPrincipalCV(xAddr, xName),
        "y-token-trait": contractPrincipalCV(yAddr, yName),
        "from-bin-id": intCV(getSignedBinId(from_bin_id)),
        "active-bin-id-offset": intCV(to_offset),
        "amount": uintCV(amount),
        "min-dlp": uintCV(min_dlp),
        "max-x-liquidity-fee": uintCV(maxXFee),
        "max-y-liquidity-fee": uintCV(maxYFee),
      });

      const tx = await makeContractCall({
        contractAddress: routerAddr,
        contractName: routerName,
        functionName: "move-relative-liquidity-multi",
        functionArgs: [listCV([movePos])],
        senderKey: wallet.privateKey,
        network,
        fee,
        postConditions: [],
        postConditionMode: PostConditionMode.Allow,
        anchorMode: AnchorMode.Any,
      });

      const result = await broadcastTransaction(tx, network);
      out({ success: true, txid: result.txid, pool_id, from_bin_id, to_bin_id: toBinId, amount });
    } catch (e: any) { err(e.message, { pool_id }); }
  });

program.parse();
