name: hodlmm
description: Bitflow HODLMM concentrated liquidity — query pools, bins, price history, user positions, get swap quotes, and manage liquidity (add/withdraw/move) on Bitflow's Bitcoin DeFi engine on Stacks. Mainnet-only.
metadata:
user-invocable: "false"
arguments: "pools | pool | pairs | tokens | bins | bin-price-history | position | position-bins | quote | health | add-liquidity | withdraw-liquidity | move-liquidity"
entry: "hodlmm/hodlmm.ts"
requires: "wallet, settings"
tags: "defi, l2, mainnet-only, read-only, write, requires-funds"
author: "davieslennox0"
author-agent: "Void Parrot"
hodlmm
Interact with Bitflow's HODLMM — a concentrated liquidity engine for Bitcoin DeFi on Stacks. Supports sBTC, STX, and USDCx pools.
API Base
https://bff.bitflowapis.finance/api
API key is optional during BETA. Set HODLMM_API_KEY in env for authenticated access.
Subcommands
Read Operations
pools
List all available HODLMM pools.
bun run hodlmm/hodlmm.ts pools
pool <pool_id>
Get full data for a specific pool including fees, active bin, reserves.
bun run hodlmm/hodlmm.ts pool SP3ESW1QCNQPVXJDGQWT7E45RDCH38QBK9HEJSX4X.dlmm-sbtc-usdcx-v-0-1
pairs
List all available trading pairs.
bun run hodlmm/hodlmm.ts pairs
tokens
List all available tokens with contract addresses and asset names.
bun run hodlmm/hodlmm.ts tokens
bins <pool_id>
Get all bin data for a pool — prices, reserves, liquidity per bin.
bun run hodlmm/hodlmm.ts bins SP3ESW1QCNQPVXJDGQWT7E45RDCH38QBK9HEJSX4X.dlmm-sbtc-usdcx-v-0-1
bin-price-history <pool_id>
Get historical bin price data for a pool.
bun run hodlmm/hodlmm.ts bin-price-history SP3ESW1QCNQPVXJDGQWT7E45RDCH38QBK9HEJSX4X.dlmm-sbtc-usdcx-v-0-1
position <pool_id> [address]
Get user's liquidity position for a pool. Uses active wallet address if not specified.
bun run hodlmm/hodlmm.ts position SP3ESW1QCNQPVXJDGQWT7E45RDCH38QBK9HEJSX4X.dlmm-sbtc-usdcx-v-0-1
bun run hodlmm/hodlmm.ts position SP3ESW1QCNQPVXJDGQWT7E45RDCH38QBK9HEJSX4X.dlmm-sbtc-usdcx-v-0-1 --address SP1234...
position-bins <pool_id> [address]
Get user's position broken down by bin.
bun run hodlmm/hodlmm.ts position-bins SP3ESW1QCNQPVXJDGQWT7E45RDCH38QBK9HEJSX4X.dlmm-sbtc-usdcx-v-0-1
quote <input_token> <output_token> <amount>
Get swap quote for a token pair.
bun run hodlmm/hodlmm.ts quote SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token SP3Y2DC0WJ8AZAB8FBP9ZSJ1Q0X2WKMAX23NXN4GZ.usdcx 100000000
health
Check HODLMM API health and per-pool sync status.
bun run hodlmm/hodlmm.ts health
Write Operations (requires unlocked wallet)
add-liquidity <pool_id> <bin_id> <x_amount> <y_amount>
Add liquidity to a specific bin. Uses simple (relative) mode by default.
bun run hodlmm/hodlmm.ts add-liquidity SP3ESW1QCNQPVXJDGQWT7E45RDCH38QBK9HEJSX4X.dlmm-sbtc-usdcx-v-0-1 500 10000000 1750000
withdraw-liquidity <pool_id> <percentage>
Withdraw percentage of all position bins. 100 = full withdrawal.
bun run hodlmm/hodlmm.ts withdraw-liquidity SP3ESW1QCNQPVXJDGQWT7E45RDCH38QBK9HEJSX4X.dlmm-sbtc-usdcx-v-0-1 50
move-liquidity <pool_id> <from_bin_id> <to_bin_offset> <amount>
Move liquidity from one bin to another (offset relative to active bin).
bun run hodlmm/hodlmm.ts move-liquidity SP3ESW1QCNQPVXJDGQWT7E45RDCH38QBK9HEJSX4X.dlmm-sbtc-usdcx-v-0-1 480 0 12848399
Output Format
All commands output JSON to stdout:
{
  "success": true,
  "data": { ... },
  "pool_id": "...",
  "active_bin": 500,
  "bin_count": 100
}
Errors:
{ "error": "Pool not found", "pool_id": "..." }
Strategy Notes
Active bin is where both tokens trade. Bins above = x-token only. Bins below = y-token only.
Simple mode (default for add/move): uses bin offsets, more resilient to bin shifts.
Strict mode: uses exact bin IDs, reverts if active bin shifts before execution.
Slippage default: 1%. Adjust with --slippage <value>.
Pools: sBTC/USDCx, STX/USDCx launch pools. More pairs expanding.
