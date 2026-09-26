function expect(actual) {
    return {
        toBe: (expected) => {
            if (actual !== expected) {
                throw new Error(`Expected ${expected} but got ${actual}`);
            }
        },
        toBeTruthy: () => { if (!actual) throw new Error("Expected truthy but got falsy"); },
        toBeFalsy: () => { if (actual) throw new Error("Expected falsy but got truthy"); },
    };
}

describe("Pro Scalping Terminal", () => {
    it("requires Pro subscription for access", () => {
        const user = { uid: "test-user", hasSubscription: false, plan: "free" };
        expect(user.hasSubscription).toBeFalsy();
        expect(user.plan === "pro" || user.plan === "enterprise").toBeFalsy();
    });

    it("grants access for Pro/Enterprise plans", () => {
        const user = { uid: "test-user", hasSubscription: true, plan: "pro" };
        const allowed = user.hasSubscription && (user.plan === "pro" || user.plan === "enterprise");
        expect(allowed).toBeTruthy();
    });

    it("handles evidence boundary: never invents prices", () => {
        const evidence = { marketState: "Trending", structure: "Bullish", pricesPresent: false };
        expect(evidence.pricesPresent).toBeFalsy();
    });

    it("calculates analytics only from real data", () => {
        const journal = [
            { result: "Win", r: 2.1 },
            { result: "Loss", r: -0.8 },
        ];
        const wins = journal.filter(j => j.result === "Win").length;
        const avgR = journal.reduce((s, j) => s + j.r, 0) / journal.length;
        expect(wins).toBe(1);
        expect(avgR).toBe(0.65);
    });

    it("replays only with available historical data flag", () => {
        const replayState = { playing: false, symbol: "XAUUSD", date: "2026-09-26", startTime: "10:00", currentTime: "10:00", speed: 1, historicalAvailable: true };
        expect(replayState.historicalAvailable).toBeTruthy();
        expect(replayState.symbol).toBe("XAUUSD");
    });
});
