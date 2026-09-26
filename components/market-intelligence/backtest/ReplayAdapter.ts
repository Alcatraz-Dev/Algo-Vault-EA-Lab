/**
 * Replay Adapter — connects ReplayEngine to page state.
 */
import { ReplayEngine } from "../../lib/market-intelligence/backtesting/replay";

export interface ReplayUIState {
  playing: boolean;
  index: number;
  total: number;
  speedIndex: number;
  timestamp?: number;
}

export function getReplayState(engine: ReplayEngine, totalCandles: number): ReplayUIState {
  return {
    playing: false,
    index: 0,
    total: totalCandles,
    speedIndex: 0,
  };
}
