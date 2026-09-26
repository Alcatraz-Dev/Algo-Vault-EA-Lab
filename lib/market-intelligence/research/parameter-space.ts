/**
 * Parameter Space — deterministic Cartesian generation.
 */
import { ParameterDefinition, ResearchConfiguration, ParameterSpace } from "./types";

export function generateConfigurations(
  space: ParameterSpace,
  limits: { maxConfigurations?: number; maxParameters?: number; maxValuesPerParameter?: number } = {}
): ResearchConfiguration[] {
  const defs = space.definitions.slice();
  const maxConfigs = limits.maxConfigurations ?? 1000;
  const maxParams = limits.maxParameters ?? 5;
  const maxVals = limits.maxValuesPerParameter ?? 10;

  if (defs.length > maxParams) throw new Error("Parameter count exceeds maxParameters.");
  for (const d of defs) {
    const vals = d.values ?? (d.type === "boolean" ? [true, false] : d.type === "integer" || d.type === "number" ? generateNumericValues(d, maxVals) : []);
    if (vals.length > maxVals) throw new Error(`Parameter ${d.id} values exceed maxValuesPerParameter.`);
  }

  const valuesPerDef = defs.map((d) => d.values ?? (d.type === "boolean" ? [true, false] : d.type === "integer" || d.type === "number" ? generateNumericValues(d, maxVals) : ["unknown"]));

  const combos: Record<string, unknown>[] = [];
  function cartesian(current: number[], path: Record<string, unknown>) {
    if (current.length === defs.length) {
      combos.push({ ...path });
      return;
    }
    const idx = current.length;
    for (const v of valuesPerDef[idx]) {
      path[defs[idx].id] = v;
      cartesian([...current, idx + 1], path);
      delete path[defs[idx].id];
    }
  }
  cartesian([], {});

  if (combos.length > maxConfigs) throw new Error(`Configuration count (${combos.length}) exceeds maxConfigurations (${maxConfigs}).`);

  const out: ResearchConfiguration[] = combos.map((p, i) => {
    const key = Object.entries(p)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("|");
    return { id: `cfg_${key}`, parameters: p };
  });

  return out;
}

function generateNumericValues(d: ParameterDefinition, maxVals: number): number[] {
  if (d.type !== "number" && d.type !== "integer") return [];
  if (d.min === undefined || d.max === undefined) return [];
  const step = d.step ?? (d.type === "integer" ? 1 : (d.max - d.min) / 10);
  if (step <= 0) throw new Error(`Invalid step for ${d.id}`);
  const values: number[] = [];
  for (let v = d.min; v <= d.max + 1e-9; v += step) {
    values.push(d.type === "integer" ? Math.round(v) : parseFloat(v.toFixed(2)));
    if (values.length >= maxVals) break;
  }
  // Deduplicate while preserving order
  const seen = new Set<number>();
  return values.filter((v) => { if (seen.has(v)) return false; seen.add(v); return true; });
}
