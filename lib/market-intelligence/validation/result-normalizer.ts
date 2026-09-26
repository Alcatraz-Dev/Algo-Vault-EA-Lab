export function normalizeResult(stage: string, existingResult: any): any {
  return { stage, resultId: existingResult?.id || "existing", source: "existing-engine", notes: existingResult ? ["Real engine output preserved."] : ["Result unavailable."] };
}
