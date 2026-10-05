"use client";

import { Shield, AlertTriangle, BookOpen } from "lucide-react";

export default function TrustMethodologyPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">How AlgoVault Tests Strategies</h1>
        <p className="text-muted-foreground">Transparent methodology — no guaranteed performance claims.</p>
      </header>

      <section className="border rounded-xl p-6 bg-card space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2"><BookOpen className="w-5 h-5" /> Certification Levels</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {[
            { name: "UNVERIFIED", desc: "No independent testing performed." },
            { name: "TESTED", desc: "Valid strategy; successful backtest; sufficient sample." },
            { name: "OOS VERIFIED", desc: "OOS passed; no severe degradation." },
            { name: "ROBUST", desc: "Includes WFA, Monte Carlo, parameter sensitivity, execution sensitivity." },
            { name: "CERTIFIED", desc: "All required tests passed; limitations documented; reproducible report available." },
          ].map((c) => (
            <div key={c.name} className="rounded-lg border p-4 bg-muted/30 space-y-1">
              <div className="font-bold text-sm">{c.name}</div>
              <div className="text-sm text-muted-foreground">{c.desc}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="border rounded-xl p-6 bg-card space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2"><Shield className="w-5 h-5" /> What Certification Does NOT Mean</h2>
        <ul className="list-disc pl-6 text-sm text-muted-foreground space-y-1">
          <li>Certification is methodology-based, not a guarantee of future profitability.</li>
          <li>Backtests are simulations. Execution conditions, slippage, and latency differ in live markets.</li>
          <li>Market conditions change. Regime stability is measured but not guaranteed to persist.</li>
          <li>Parameter sensitivity indicates how robust a strategy is — not its profitability under all conditions.</li>
          <li>No strategy is guaranteed. Always review limitations and historical coverage.</li>
        </ul>
      </section>

      <section className="border rounded-xl p-6 bg-card space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> Monitoring & Expiry</h2>
        <p className="text-sm text-muted-foreground">Certification includes an expiration/review date. After certification, live or paper performance is monitored. If serious degradation occurs, certification moves to <strong>REVIEW_REQUIRED</strong>. Historical certification records are preserved — they are not deleted silently.</p>
      </section>
    </div>
  );
}
