/**
 * Historical Replay Engine
 *
 * Processes candles incrementally.
 * Never exposes future candles.
 * Smart Money events calculated only from available candles.
 */

import { MarketCandle, Timeframe } from "../../market-data/types";
import { SmartMoneyEngine } from "../smart-money/engine";
import { orderFlowAtBoundary } from "@/lib/order-flow/replay";
import { orderFlowGate } from "@/lib/order-flow/settings";
import type { OrderFlowContext } from "@/lib/order-flow/types";

export class ReplayEngine {
  private engine = new SmartMoneyEngine({ mode: "replay" });
  private progress = 0;
  private readonly withOrderFlow: boolean;

  constructor(
    private candles: MarketCandle[],
    private tf: string,
    options?: { orderFlow?: boolean }
  ) {
    // Order Flow context is opt-in and flag-gated: existing replay consumers
    // keep receiving exactly the shape they had before this feature.
    this.withOrderFlow = (options?.orderFlow ?? false) && orderFlowGate("orderFlow.enabled");
  }

  /** Order Flow state at the current replay boundary (flag-gated). */
  private orderFlowContextAt(index: number): OrderFlowContext | null {
    if (!this.withOrderFlow || this.candles.length === 0) return null;
    try {
      return orderFlowAtBoundary(
        {
          symbol: "REPLAY",
          timeframe: this.tf as Timeframe,
          candles: this.candles,
        },
        index,
      );
    } catch {
      return null;
    }
  }

  getProgress(): number {
    return this.progress / (this.candles.length || 1);
  }

  /** Current replay index (0-based candle position) for UI adapters. */
  getIndex(): number {
    return this.progress;
  }

  step(): { candles: MarketCandle[]; events: unknown[]; index: number; orderFlowContext?: OrderFlowContext | null } | null {
    if (this.progress >= this.candles.length) return null;
    const available = this.candles.slice(0, this.progress + 1);
    const result = this.engine.run(available, this.tf as import("../types").Timeframe, "replay");
    const index = this.progress;
    this.progress++;
    return {
      candles: available,
      events: result.events,
      index,
      // Computed BEFORE the progress increment: strictly the state at `index`.
      ...(this.withOrderFlow ? { orderFlowContext: this.orderFlowContextAt(index) } : {}),
    };
  }

  seek(index: number): { candles: MarketCandle[]; events: unknown[]; orderFlowContext?: OrderFlowContext | null } {
    this.progress = Math.min(index + 1, this.candles.length);
    const available = this.candles.slice(0, this.progress);
    const result = this.engine.run(available, this.tf as import("../types").Timeframe, "replay");
    return {
      candles: available,
      events: result.events,
      ...(this.withOrderFlow ? { orderFlowContext: this.orderFlowContextAt(this.progress - 1) } : {}),
    };
  }

  reset() {
    this.progress = 0;
  }
}
