# AlgoVault Strategy Studio — Architecture Decision

## Status
Implemented as `AlgoVault Bot Studio` (`/admin/bot-studio`). Pro-facing Strategy Studio is the same system; no duplicate surface is created (Rule 3).

## Layers
- Authoring: `/admin/bot-studio/editor` (AVS) and `/admin/bot-studio/builder` (visual, @xyflow/react).
- Compilers: `lib/bot-studio/compiler/avscript-to-strategy.ts`, `visual-to-strategy.ts` → canonical `Strategy` (`lib/strategy-lab/types.ts`).
- Validation: `lib/strategy-engine/validation.ts` (`validateStrategyDefinition`).
- Runtime: `lib/bot-studio/runtime.ts` (`BotRuntimeSession`), uses `lib/strategy-engine` evaluator; no fabricated fills.
- Backtest: `lib/strategy-lab/backtest.ts` (`backtestStrategy`).
- Execution: existing MT5 gateway (`trading_order_requests`, `mt5_orders`, `live_positions`); commands polled by `MQL5/AlgoVaultTradeGateway/AlgoVaultTradeGateway.mq5`.
- Persistence: `lib/bot-studio/database.ts` (RTDB `bot_strategies`, `bot_deployments`, etc.).
- Lifecycle: `lib/bot-studio/lifecycle.ts`.
- Magic numbers: `lib/bot-studio/magic-numbers.ts` (range 100M–199M).

## AVS
Versioned `AVSCRIPT_COMPILER_VERSION` = 1.0.0. Secure: size guard 8KB, forbidden-pattern scan, Pine lexer tokenization, no eval/Function. Compiles to identical canonical Strategy as visual builder.

## Verification
- `npm run test:bot-studio` — all tests pass.
- `npm run build` — succeeds.
- `npx tsc --noEmit` — no errors.
- MT5 demo execution: gateway protocol inspected (commands/execution routes + EA); integration uses existing server-authoritative path; not live-verified (no broker account available).
