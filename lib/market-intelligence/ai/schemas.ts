/**
 * AI Schemas — output validation and structured contracts.
 */

export const AIResponseSchema = {
  summary: "string",
  observations: [{ type: "fact" | "interpretation" | "limitation", text: "string", sourceIds: ["string"] }],
  evidence: [{ type: "string", id: "string?", timestamp: "number?" }],
  suggestions: [{ type: "modify" | "add" | "remove" | "explain", target: "string?", reason: "string", requiresBacktest: "boolean?" }],
  limitations: ["string"],
};

export function isValidAIResponse(obj: any): boolean {
  if (typeof obj !== "object" || obj === null) return false;
  if (typeof obj.summary !== "string") return false;
  if (!Array.isArray(obj.observations)) return false;
  if (!Array.isArray(obj.limitations)) return false;
  for (const o of obj.observations ?? []) {
    if (!["fact", "interpretation", "limitation"].includes(o.type)) return false;
  }
  return true;
}
