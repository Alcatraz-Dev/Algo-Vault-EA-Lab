/** Factual statistics only — no predictions, no scores, no ranking. */
export function formatStatistics(stats: any): string[] {
  const lines: string[] = [];
  if (stats.occurrences != null) lines.push(`Occurrences: ${stats.occurrences}`);
  if (stats.triggered != null) lines.push(`Triggered: ${stats.triggered}`);
  if (stats.invalidated != null) lines.push(`Invalidated: ${stats.invalidated}`);
  if (stats.expired != null) lines.push(`Expired: ${stats.expired}`);
  if (stats.missingEvidence != null) lines.push(`Missing evidence: ${stats.missingEvidence}`);
  if (stats.recordsExcluded != null && stats.recordsExcluded > 0) lines.push(`Excluded records: ${stats.recordsExcluded}`);
  if (stats.dataQualityStatus) lines.push(`Data quality: ${stats.dataQualityStatus}`);
  lines.push("No predictive probability. Historical observation only.");
  return lines;
}
