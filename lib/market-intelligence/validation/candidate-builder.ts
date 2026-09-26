// Convert evidence definition to existing strategy/research representation; do not create second strategy engine.
export function buildCandidate(def: any): any {
  return { evidenceDefinition: def, strategyCandidate: null, status: "DRAFT", note: "Requires user confirmation and existing adapter validation." };
}
