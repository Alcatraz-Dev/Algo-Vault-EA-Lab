/** Analytics filters — deterministic only. No ranking. */
export interface AnalyticsFilter { symbol?: string; timeframe?: string; session?: string; status?: string; eventType?: string; dateRange?: { start?: number; end?: number } }
export function applyFilter(record: any, filter: AnalyticsFilter): boolean {
  if (filter.symbol && record.symbol !== filter.symbol) return false;
  if (filter.timeframe && record.timeframe !== filter.timeframe) return false;
  if (filter.status && record.status !== filter.status) return false;
  return true;
}
