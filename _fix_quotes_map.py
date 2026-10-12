import subprocess, sys
p = "/Users/haythem_dhahri/Desktop/projects/website/trading-platform/app/api/market/quotes/route.ts"
s = open(p).read()
s = s.replace(
    "const freshnessWindowMs = 120_000; // two M1 bars — stale after ~2 bars gone",
    "const quotes: Record<string, { price: number; change?: number; changePercent?: number; timestamp: number; provider: string }> = {};\n    const freshnessWindowMs = 120_000; // two M1 bars — stale after ~2 bars gone",
)
s = s.replace("for (const [rawSymbol, quote] of Object.entries(quotes)) {", "for (const [rawSymbol, quote] of Object.entries(quotes)) {")
s = s.replace("success: true,\n            quotes,\n            fresh:", "success: true,\n            quotes,\n            fresh:")
open(p, "w").write(s)
print("patched")
