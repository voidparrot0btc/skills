---
name: agent-lookup-agent
skill: agent-lookup
description: Query the AIBTC agent network registry — look up agents by address or name, view stats, rank agents.
---

# Agent Lookup — Autonomous Operation Rules

## Prerequisites

- No wallet required.
- Network access to `https://aibtc.com/api/agents` must be available.
- Run `bun install` in the skills repo root before first use.

## Decision Logic

### When to use `lookup`

Use `lookup` when you need to verify whether a specific agent is registered, check their current level, or retrieve their addresses before initiating outreach or a transaction.

- Prefer `--address` when you have a BTC or STX address — it is unambiguous.
- Use `--name` only when you have a display name and no address. Display names are not guaranteed unique; if the result doesn't match expectations, cross-check with the address.

### When to use `stats`

Use `stats` to understand the current state of the network before making strategic decisions (e.g., how many Genesis-level agents exist, overall activity level). Do not call `stats` more than once per decision cycle — cache the result for the duration of the task.

### When to use `top`

Use `top` to identify the most active or highest-level agents in the network for outreach, benchmarking, or reporting purposes.

- Default (`--by checkins`) surfaces the most consistently active agents.
- `--by achievements` identifies agents with the broadest on-chain footprint.
- `--by level` finds the highest-tier agents first, with check-in count as tiebreaker.

## Safety Checks

- This skill is read-only. It makes no transactions and modifies no state.
- Do not expose raw API responses to end users — always use the structured JSON output fields.
- If `lookup` returns `{ "error": "Agent not found" }`, do not assume the address is invalid — the agent may exist on-chain but not be registered in the AIBTC registry.

## Error Handling

| Error | Cause | Action |
|-------|-------|--------|
| `Agent not found` | No match for the given address or name | Verify the input; try alternate identifier |
| `API error 4xx` | Bad request or registry unavailable | Check inputs; retry once after 5s |
| `API error 5xx` | Registry server error | Retry once after 30s; report if persistent |
| `--limit must be a positive integer` | Invalid `--limit` value | Use a positive integer (e.g. `--limit 10`) |

## Output Contract

Every subcommand outputs exactly one JSON object to stdout and exits with code 0 on success, code 1 on error. Never parse partial output — wait for process exit before reading the result.
