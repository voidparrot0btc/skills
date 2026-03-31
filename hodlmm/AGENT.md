AGENT.md — hodlmm
Purpose
Autonomous rules for interacting with Bitflow HODLMM concentrated liquidity pools. Read operations are safe anytime. Write operations (add/withdraw/move) require explicit confirmation and checks.
Prerequisites
Wallet unlocked: bun run wallet/wallet.ts status
Sufficient sBTC/STX/USDCx balance for add-liquidity operations
HODLMM_API_KEY env var (optional during BETA)
Decision Rules
Before ANY write operation
Run health — abort if API is degraded
Run pool <pool_id> — verify pool exists and is active
Run bins <pool_id> — confirm active bin ID
Run position-bins <pool_id> — check existing positions
add-liquidity
Only add x-token to bins ABOVE active bin
Only add y-token to bins BELOW active bin
Active bin accepts both tokens
Default to simple mode (offset-based) to avoid reverts
Never add > 10% of total position in a single bin unless explicitly instructed
withdraw-liquidity
Confirm user has position before attempting withdrawal
Default slippage: 1%. Increase to 2% only in volatile markets.
Prefer partial withdrawals (50%) over full unless instructed
move-liquidity
Verify from_bin has user liquidity > 0
Check to_bin exists in pool bins
Respect x/y token rules for destination bin
Error Handling
pool not found → run pools to list valid pool IDs
bin not found → run bins <pool_id> to see valid bin range
insufficient balance → run wallet balance check before retrying
API 402/401 → set HODLMM_API_KEY in environment
Safety Limits
Never move 100% of position without explicit instruction
Never add liquidity during API health degradation
Log all transaction IDs after broadcast
