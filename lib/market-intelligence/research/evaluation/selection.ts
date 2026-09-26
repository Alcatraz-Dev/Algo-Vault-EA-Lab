/**
 * Selection — user selects; no automatic ranking.
 */
export interface SelectionRequest {
  configurationIds: string[];
  maxComparisons?: number;
}

export function selectConfigurations(request: SelectionRequest): string[] {
  const limit = request.maxComparisons ?? 5;
  if (request.configurationIds.length > limit) {
    return request.configurationIds.slice(0, limit); // honor limit; do not silently drop beyond limit without notice
  }
  return request.configurationIds;
}
