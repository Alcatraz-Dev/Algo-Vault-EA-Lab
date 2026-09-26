export function buildEvidenceReport(candidate: any, stages: any[]): any {
  return {
    pattern: candidate?.evidenceDefinition,
    stages: stages.map((s) => ({ stage: s.stage, status: s.status, resultId: s.resultId, note: s.note })),
    limitations: ["Resultados are historical simulations, not future predictions.", "Backtest uses next_bar_open.", "OOS is unseen validation period.", "Monte Carlo resamples actual trades."],
    dataQuality: "Refer to existing data-quality report.",
  };
}
