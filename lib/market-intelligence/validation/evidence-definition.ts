// Converts historical pattern to precise reproducible definition; separates historical observation from validation conditions.
export function buildEvidenceDefinition(pattern: any, conditions?: string[]): any {
  return {
    sourcePatternId: pattern?.id,
    symbol: pattern?.symbol,
    timeframe: pattern?.timeframe,
    session: pattern?.session,
    liquidity: pattern?.liquidity,
    structure: pattern?.structure,
    fvg: pattern?.fvg,
    orderBlock: pattern?.orderBlock,
    mtf: pattern?.mtf,
    conditions: conditions || [],
    mode: pattern?.mode || "BACKTEST",
    note: "Historical observation separated from validation conditions.",
  };
}
