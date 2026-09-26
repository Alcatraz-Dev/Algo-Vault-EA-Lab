/**
 * AlgoVault scalping terminal — watchlist vocabulary (leaf module).
 *
 * The default watchlist and the default execution timeframe, declared in a
 * module whose only imports are market-data *types*. `radar.ts` re-exports both
 * symbols so server code keeps a single import path, while client components
 * import from here.
 *
 * Why the split: the terminal's watchlist picker needs these two values, and
 * importing them from `radar.ts` would drag the whole agent pipeline
 * (`lib/ai/agents/pipeline.ts`, ~960 lines) plus ten analytics modules and the
 * risk engine into the browser bundle. `import type` cannot help — these are
 * values. Keeping them in a leaf preserves the same constants without the
 * transitive cost, and there is only one definition, so nothing can drift.
 */

import type { SupportedSymbol, Timeframe } from "@/lib/market-data/types";

/** Default watchlist for the terminal. A subset of SUPPORTED_SYMBOLS. */
export const RADAR_SYMBOLS: SupportedSymbol[] = [
    "XAUUSD",
    "EURUSD",
    "GBPUSD",
    "NAS100",
    "BTCUSD",
];

/** Default execution timeframe for scalping. */
export const RADAR_TIMEFRAME: Timeframe = "M5";
