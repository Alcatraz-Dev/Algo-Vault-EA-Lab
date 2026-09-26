/**
 * Replay UI Adapter — connects ReplayEngine to Trading Studio UI state
 */
import { ReplayEngine } from "./backtesting/replay";

export interface ReplayUIState {
  playing: boolean;
  speedIndex: number; // 0=1x, 1=5x, 2=10x, 3=50x, 4=100x
  index: number;
  total: number;
  events: unknown[];
}

export function replayUIStateFromEngine(engine: ReplayEngine, candlesLength: number): ReplayUIState {
  return {
    playing: false,
    speedIndex: 0,
    index: engine.progress || 0,
    total: candlesLength,
    events: [],
  };
}
