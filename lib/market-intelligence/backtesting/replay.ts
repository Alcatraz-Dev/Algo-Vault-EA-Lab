/**
 * Historical Replay Engine
 *
 * Processes candles incrementally.
 * Never exposes future candles.
 * Smart Money events calculated only from available candles.
 */

import { MarketCandle } from "../../market-data/types";
import { SmartMoneyEngine } from "../smart-money/engine";

export class ReplayEngine {
  private engine = new SmartMoneyEngine({ mode: "replay" });
  private progress = 0;

  constructor(private candles: MarketCandle[], private tf: string) {}

  getProgress(): number {
    return this.progress / (this.candles.length || 1);
  }

  step(): { candles: MarketCandle[]; events: unknown[]; index: number } | null {
    if (this.progress >= this.candles.length) return null;
    const available = this.candles.slice(0, this.progress + 1);
    const result = this.engine.run(available, this.tf as any, "replay");
    this.progress++;
    return {
      candles: available,
      events: result.events,
      index: this.progress - 1,
    };
  }

  seek(index: number): { candles: MarketCandle[]; events: unknown[] } {
    this.progress = Math.min(index + 1, this.candles.length);
    const available = this.candles.slice(0, this.progress);
    const result = this.engine.run(available, this.tf as any, "replay");
    return { candles: available, events: result.events };
  }

  reset() {
    this.progress = 0;
  }
}
