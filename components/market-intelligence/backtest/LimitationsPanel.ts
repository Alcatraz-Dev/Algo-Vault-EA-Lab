/**
 * Limitations Panel — exposes actual limitations from backtest/replay/engine.
 */
export function buildLimitationsString(
  backtestLimitations?: string[],
  replayLimitations?: string[],
  dataQuality?: any
): string[] {
  const out: string[] = [];
  if (backtestLimitations && backtestLimitations.length > 0) out.push(...backtestLimitations);
  if (replayLimitations && replayLimitations.length > 0) out.push(...replayLimitations);
  if (dataQuality?.status === "incomplete") out.push("Data quality incomplete.");
  if (dataQuality?.gaps && dataQuality.gaps > 0) out.push(`Data gaps detected: ${dataQuality.gaps}.`);
  if (dataQuality?.spreadAvailable === false) out.push("Historical spread unavailable; configured spread used.");
  return out;
}
