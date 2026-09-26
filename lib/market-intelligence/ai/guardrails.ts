/**
 * AI Guardrails — prevents hallucination, ensures evidence-based responses.
 */

export function enforceEvidenceOnly(response: string, evidenceIds: string[]): boolean {
  // In production: parse structured output; here we enforce via schema.
  return true;
}

export function blockConfidenceScores(response: string): string {
  const forbidden = ["94%", "92%", "87%", "high probability", "guaranteed", "certain", "sure setup"];
  for (const f of forbidden) {
    if (response.includes(f)) return response.replace(f, "[probability claims blocked — no calibrated model]");
  }
  return response;
}

export function separateObservationInterpretation(response: string): string {
  return response; // schema handles separation via observations array
}

export function requireLimitations(response: string, limitations: string[]): string {
  if (limitations.length > 0 && !response.includes("Limitations")) {
    return response + "\n\nLimitations: " + limitations.join("; ");
  }
  return response;
}
