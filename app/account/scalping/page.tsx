"use client";
import AccountShell from "@/components/account/AccountShell";
import ScalpingTerminal from "@/components/live/ScalpingTerminal";

export default function AccountScalpingPage() {
  return (
    <AccountShell title="Scalping Terminal" subtitle="Real-time scalping intelligence">
      <div className="space-y-6">
        <ScalpingTerminal pro />
        <div className="rounded-2xl border border-border bg-card/60 p-6">
          <h2 className="text-lg font-extrabold tracking-tight text-foreground mb-3">Advanced Scalping Signals</h2>
          <p className="text-sm text-muted-foreground mb-4">Pro-level scalping data aggregated across XAUUSD, NAS100, EURUSD, BTCUSD and more. No individual data exposed.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {["XAUUSD","BTCUSD","EURUSD","NASDAQ","US500","GBPUSD"].map(s=>
              <div key={s} className="rounded-xl bg-card border border-border p-4 text-center"><div className="text-xs font-mono text-muted-foreground">{s}</div><div className="text-lg font-extrabold text-foreground">Active</div></div>
            )}
          </div>
        </div>
      </div>
    </AccountShell>
  );
}
