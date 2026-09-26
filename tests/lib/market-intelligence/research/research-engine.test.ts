import { generateConfigurations, ParameterSpace } from "../../../lib/market-intelligence/research/parameter-space";
import { validateParameterSpace } from "../../../lib/market-intelligence/research/validation";
import { canonicalConfigurationId } from "../../../lib/market-intelligence/research/reproducibility";

describe("Phase 6.1 Parameter Research", () => {
  it("generates deterministic combinations", () => {
    const space: ParameterSpace = {
      definitions: [
        { id: "emaFast", label: "EMA Fast", type: "integer", min: 10, max: 20, step: 10 },
      ]
    };
    const configs = generateConfigurations(space);
    expect(configs.length).toBeGreaterThan(0);
    expect(configs[0].parameters).toBeDefined();
  });

  it("deterministic IDs", () => {
    expect(canonicalConfigurationId({ a: 10 })).toBe("a=10");
  });

  it("validation fails on invalid step", () => {
    const space: ParameterSpace = {
      definitions: [{ id: "bad", label: "Bad", type: "integer", min: 1, max: 5, step: -1 }]
    };
    const v = validateParameterSpace(space);
    expect(v.valid).toBe(false);
  });

  it("limit enforced", () => {
    const space: ParameterSpace = {
      definitions: Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, label: "P", type: "integer", min: 1, max: 5, step: 1 }))
    };
    const v = validateParameterSpace(space, { maxParameters: 5 });
    expect(v.valid).toBe(false);
  });
});
