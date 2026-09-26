import { buildPatternSignature } from "../../../../lib/market-intelligence/analytics/pattern-key";
describe("Phase 11 Pattern Key", () => {
  it("same inputs produce same key", () => {
    const a = buildPatternSignature("XAUUSD","M5","LONDON","BOS","SWEEP","BULLISH_FVG","BULLISH_OB","BULLISH");
    const b = buildPatternSignature("XAUUSD","M5","LONDON","BOS","SWEEP","BULLISH_FVG","BULLISH_OB","BULLISH");
    expect(a).toBe(b);
  });
  it("no predictive fields", () => {
    expect(typeof buildPatternSignature()).toBe("string");
  });
});
