/**
 * Pattern Signature — deterministic canonical representation.
 */
export function buildPatternSignature(symbol?: string, timeframe?: string, session?: string, structure?: string, liquidity?: string, fvg?: string, ob?: string, mtf?: string): string {
  const parts = [symbol || "?", timeframe || "?", session || "?", structure || "?", liquidity || "?", fvg || "?", ob || "?", mtf || "?"];
  return parts.join("|").toUpperCase();
}
