/**
 * Validation — limits and parameter checks.
 */
import { ParameterDefinition, ParameterSpace } from "./types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateParameterSpace(space: ParameterSpace, limits?: { maxParameters?: number; maxValuesPerParameter?: number; maxConfigurations?: number }): ValidationResult {
  const errors: string[] = [];
  if (!space.definitions || space.definitions.length === 0) errors.push("No parameter definitions.");
  const ids = space.definitions.map((d) => d.id);
  if (new Set(ids).size !== ids.length) errors.push("Duplicate parameter IDs.");
  for (const d of space.definitions) {
    if (!d.type || !["number", "integer", "boolean", "enum"].includes(d.type)) errors.push(`Invalid type for ${d.id}.`);
    if (d.type === "number" || d.type === "integer") {
      if (d.step !== undefined && d.step <= 0) errors.push(`Invalid step for ${d.id}.`);
      if (d.min !== undefined && d.max !== undefined && d.min > d.max) errors.push(`Min > max for ${d.id}.`);
    }
    if (d.values !== undefined && d.values.length === 0) errors.push(`Empty enum for ${d.id}.`);
  }
  const maxP = limits?.maxParameters ?? 5;
  const maxV = limits?.maxValuesPerParameter ?? 10;
  if (space.definitions.length > maxP) errors.push(`Parameter count exceeds limit (${maxP}).`);
  for (const d of space.definitions) {
    const vals = d.values ?? (d.type === "boolean" ? [true, false] : d.type === "integer" || d.type === "number" ? [d.min ?? 0, d.max ?? 5] : []);
    if (vals.length > maxV) errors.push(`Parameter ${d.id} values exceed max (${maxV}).`);
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}
