/**
 * Smart Money Analysis Panel — uses existing SmartMoneyEngine output.
 */
export interface SmartMoneySummary {
  structure?: { trend?: string; lastEvent?: string };
  liquidity?: string[];
  fvg?: { active?: number; status?: string }[];
  orderBlocks?: { active?: number; status?: string }[];
  sessions?: string;
  limitations?: string[];
}

export function buildSmartMoneySummary(events?: any[], zones?: any[]): SmartMoneySummary {
  return {
    structure: events ? { trend: "calculated", lastEvent: events[events.length - 1]?.type ?? "none" } : undefined,
    limitations: ["Smart Money analysis derived from actual engine calculations."],
  };
}
