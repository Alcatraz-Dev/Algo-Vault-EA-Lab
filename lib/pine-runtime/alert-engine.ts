import type { AlertCondition } from "./types";

export type AlertFrequency = "once" | "once_per_bar" | "once_per_bar_close" | "every_time";

export interface PineAlertDefinition {
  id: string;
  scriptId: string;
  scriptName: string;
  symbol: string;
  timeframe: string;
  alertTitle: string;
  message: string;
  frequency: AlertFrequency;
  direction?: "long" | "short" | "neutral";
  price?: number;
  signalStrength?: "strong" | "moderate" | "weak";
  conditionSource: string;
  isActive: boolean;
  createdAt: number;
  lastTriggeredAt?: number;
}

export interface PineAlertEvent {
  id: string;
  alertId: string;
  scriptId: string;
  scriptName: string;
  symbol: string;
  timeframe: string;
  signal: string;
  price: number;
  timestamp: number;
  message: string;
  direction?: "long" | "short" | "neutral";
  signalStrength?: "strong" | "moderate" | "weak";
  isRealtime: boolean;
  deliveryStatus: "pending" | "delivered" | "failed";
  destinations: string[];
  executionStatus: "simulated" | "live" | "replay";
}

type AlertState = {
  lastTriggeredBar: number;
  lastConditionValue: boolean;
  triggeredBars: Set<number>;
};

export class PineAlertEngine {
  private alertStates = new Map<string, AlertState>();
  private alertDefs: PineAlertDefinition[] = [];

  setAlerts(alerts: PineAlertDefinition[]): void {
    this.alertDefs = alerts;
  }

  evaluateAlerts(
    alertConditions: AlertCondition[],
    barIndex: number,
    context: {
      symbol: string;
      timeframe: string;
      price: number;
      isRealtime: boolean;
      isReplay: boolean;
    }
  ): PineAlertEvent[] {
    const events: PineAlertEvent[] = [];

    for (const condition of alertConditions) {
      const state = this.alertStates.get(condition.id) || {
        lastTriggeredBar: -1,
        lastConditionValue: false,
        triggeredBars: new Set(),
      };

      const currentValue = condition.condition(barIndex);
      const previousValue = state.lastConditionValue;
      const lastBar = state.lastTriggeredBar;

      // Deduplication logic
      let shouldTrigger = false;

      if (currentValue && !previousValue) {
        // Rising edge: condition just became true
        shouldTrigger = true;
      } else if (currentValue && barIndex !== lastBar) {
        // Still true but on a new bar - check frequency
        const matchingDef = this.alertDefs.find(d => d.alertTitle === condition.title);
        if (matchingDef) {
          if (matchingDef.frequency === "every_time" && barIndex !== lastBar) {
            shouldTrigger = true;
          } else if (matchingDef.frequency === "once_per_bar_close" && !state.triggeredBars.has(barIndex)) {
            shouldTrigger = true;
          }
        } else {
          // Default: once per bar
          if (!state.triggeredBars.has(barIndex)) {
            shouldTrigger = true;
          }
        }
      }

      if (shouldTrigger) {
        state.lastTriggeredBar = barIndex;
        state.triggeredBars.add(barIndex);

        // Determine direction from signal
        const direction = this.inferDirection(condition.title, condition.message);

        const event: PineAlertEvent = {
          id: `evt_${condition.id}_${barIndex}_${Date.now()}`,
          alertId: condition.id,
          scriptId: "pine_script",
          scriptName: condition.title,
          symbol: context.symbol,
          timeframe: context.timeframe,
          signal: condition.title,
          price: context.price,
          timestamp: Date.now(),
          message: condition.message,
          direction,
          signalStrength: this.inferStrength(condition.title),
          isRealtime: context.isRealtime,
          deliveryStatus: "pending",
          destinations: [],
          executionStatus: context.isReplay ? "replay" : context.isRealtime ? "live" : "simulated",
        };

        events.push(event);
      }

      state.lastConditionValue = currentValue;
      this.alertStates.set(condition.id, state);
    }

    return events;
  }

  private inferDirection(title: string, message: string): "long" | "short" | "neutral" {
    const combined = `${title} ${message}`.toLowerCase();
    if (combined.includes("buy") || combined.includes("long") || combined.includes("bullish") || combined.includes("up")) return "long";
    if (combined.includes("sell") || combined.includes("short") || combined.includes("bearish") || combined.includes("down")) return "short";
    return "neutral";
  }

  private inferStrength(title: string): "strong" | "moderate" | "weak" {
    const lower = title.toLowerCase();
    if (lower.includes("strong") || lower.includes("confirmed") || lower.includes("breakout")) return "strong";
    if (lower.includes("weak") || lower.includes("divergence")) return "weak";
    return "moderate";
  }

  clearState(): void {
    this.alertStates.clear();
  }

  getState(): Map<string, AlertState> {
    return this.alertStates;
  }
}
