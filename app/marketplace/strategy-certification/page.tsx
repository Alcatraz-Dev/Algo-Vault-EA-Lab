"use client";

import { Shield, AlertCircle, BarChart3, CheckCircle2 } from "lucide-react";
import { generateDueDiligence } from "@/lib/intelligence-cloud/marketplace-due-diligence";

export default function StrategyCertificationPage() {
  // Conceptual — would be driven by real strategy ID and backtest results
  const dueDiligence = generateDueDiligence({ strategyId: "str-001", strategyVersion: "v2.1.3" });

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Strategy Certification</h1>
        <p className="text-muted-foreground">Transparent, methodology-based verification — not a profit guarantee.</p>
      </header>

      <section className="border rounded-xl p-6 bg-card space-y-6">
        <div className="flex items-center gap-3">
          <div className="px-3 py-1 rounded-full bg-warning text-warning text-xs font-bold">CERTIFIED</div>
          <span className="text-xs text-muted-foreground">Verified by AlgoVault — 2026-01-15 — Expires 2026-04-15</span>
        </div>

        <div className="grid md:grid-cols-3 gap-4 text-sm">
          <Score label="Historical Performance" score={82} />
          <Score label="OOS Stability" score={74} />
          <Score label="Robustness" score={81} />
          <Score label="Parameter Stability" score={63} />
          <Score label="Execution Sensitivity" score={71} />
          <Score label="Sample Size" score={91} />
        </div>

        <div className="border-t pt-4 space-y-2">
          <h3 className="font-semibold">Due Diligence Details</h3>
          <div className="grid md:grid-cols-2 gap-3 text-sm">
            <Detail label="Verification" value={dueDiligence.verificationStatus} />
            <Detail label="Backtest Trades" value={dueDiligence.backtest ? String(dueDiligence.backtest.trades) : "Not measured"} />
            <Detail label="Net Return" value={dueDiligence.backtest?.netReturnPercent !== undefined ? `${dueDiligence.backtest.netReturnPercent}%` : "Not measured"} />
            <Detail label="OOS" value={dueDiligence.oos ? (dueDiligence.oos.passed ? "Passed" : "Not passed") : "Not measured"} />
            <Detail label="WFA Stability" value={dueDiligence.walkForward?.stability !== undefined ? `${dueDiligence.walkForward.stability}/100` : "Not measured"} />
            <Detail label="Monte Carlo" value={dueDiligence.monteCarlo ? `${dueDiligence.monteCarlo.survivorshipRate ?? "—"}% survivorship` : "Not measured"} />
            <Detail label="Max Drawdown" value={dueDiligence.backtest?.maxDrawdownPercent !== undefined ? `${dueDiligence.backtest.maxDrawdownPercent}%` : "Not measured"} />
            <Detail label="Sample Size" value={dueDiligence.sampleSize !== undefined ? `${dueDiligence.sampleSize} trades` : "Not measured"} />
          </div>
        </div>

        <div className="rounded-lg bg-warning text-warning p-4 text-sm flex gap-3">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <div>
            <strong>Limitations</strong>
            <ul className="list-disc pl-5 mt-1 space-y-0.5">
              {dueDiligence.limitations.map((lim, i) => <li key={i}>{lim}</li>)}
            </ul>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          Methodology: Independent due diligence uses backtest, out-of-sample (OOS), walk-forward analysis (WFA), Monte Carlo robustness, parameter sensitivity, and execution sensitivity tests performed by AlgoVault's strategy-engine and research-engine. Scores reflect methodology completeness and stability, not future profitability.
        </div>
      </section>
    </div>
  );
}

function Score({ label, score }: { label: string; score: number }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs"><span className="font-medium">{label}</span><span className="font-mono">{score}</span></div>
      <div className="w-full h-2 bg-muted rounded-full overflow-hidden"><div className="h-full bg-positive rounded-full" style={{ width: `${score}%` }} /></div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><span className="text-muted-foreground">{label}:</span> <span className="font-medium">{value}</span></div>;
}
