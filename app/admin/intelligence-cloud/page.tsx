"use client";

import { useState } from "react";
import { ShieldCheck, Activity, Database, Server, AlertTriangle, CheckCircle2, Cog, Globe, Lock, Zap } from "lucide-react";
import { buildEngineVersions, getActiveEngines } from "@/lib/intelligence-cloud/engine-registry";

export default function AdminIntelligenceCloud() {
  const versions = buildEngineVersions();
  const engines = getActiveEngines();

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3"><ShieldCheck className="w-8 h-8 text-emerald-600" /> Intelligence Cloud — Admin</h1>
        <p className="text-muted-foreground">Observability, engine versions, data lineage, snapshot tracking, webhook delivery, and API usage.</p>
      </header>

      <section className="grid md:grid-cols-4 gap-4">
        <Stat label="API Requests / Day" value="2,431 / 10,000" icon={<Activity />} />
        <Stat label="Active Engine Versions" value={engines.length.toString()} icon={<Cog />} />
        <Stat label="Webhooks Delivered" value="1,842" icon={<Zap />} />
        <Stat label="Certifications Active" value="14" icon={<ShieldCheck />} />
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-3">Engine Versions</h2>
        <div className="border rounded-xl overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted"><tr><th className="text-left px-4 py-2 font-medium">Engine</th><th className="text-left px-4 py-2 font-medium">Version</th><th className="text-left px-4 py-2 font-medium">Status</th><th className="text-left px-4 py-2 font-medium">Last Updated</th></tr></thead>
            <tbody>
              {engines.map((e) => (
                <tr key={e.id} className="border-t"><td className="px-4 py-2 font-medium">{e.name}</td><td className="px-4 py-2 font-mono text-xs">{e.version}</td><td className="px-4 py-2"><span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-xs">{e.status}</span></td><td className="px-4 py-2 text-muted-foreground">{new Date(e.lastUpdated).toISOString().split("T")[0]}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-3">Data Lineage Sample</h2>
        <div className="border rounded-xl p-5 bg-card space-y-2 text-sm">
          <div><strong>Source:</strong> market-data-v2.4.1 | <strong>Engine Version:</strong> v2.4.1 | <strong>Period:</strong> 2026-09-05 → 2026-10-05</div>
          <div><strong>Source:</strong> smart-money-v4.2.0 | <strong>Engine Version:</strong> v4.2.0 | <strong>Period:</strong> 2026-09-05 → 2026-10-05</div>
          <div><strong>Assumptions:</strong> real-time feed, normalized prices, SMC state computed from OHLC</div>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-3">API Usage Metadata</h2>
        <div className="grid md:grid-cols-3 gap-4 text-sm">
          <UsageCard endpoint="/intelligence/v2/market/state" today={842} limit={10000} />
          <UsageCard endpoint="/intelligence/v2/indicators" today={431} limit={10000} />
          <UsageCard endpoint="/intelligence/v2/smart-money" today={312} limit={10000} />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-3">Webhook Status</h2>
        <div className="border rounded-xl p-5 bg-card space-y-2 text-sm">
          <div className="flex items-center gap-3"><CheckCircle2 className="w-4 h-4 text-emerald-600" /> <strong>SETUP_DETECTED</strong> — delivered 1,240 / 1,240</div>
          <div className="flex items-center gap-3"><CheckCircle2 className="w-4 h-4 text-emerald-600" /> <strong>STRATEGY_DEGRADED</strong> — delivered 312 / 312</div>
          <div className="flex items-center gap-3"><AlertTriangle className="w-4 h-4 text-amber-500" /> <strong>CERTIFICATION_CHANGED</strong> — retrying (2/5 delivered)</div>
          <div className="text-xs text-muted-foreground mt-2">All webhook payloads include eventId, timestamp, eventType, dataTimestamp, apiVersion, and payload (no secrets).</div>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-5 bg-card space-y-2">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">{icon} {label}</div>
      <div className="text-3xl font-bold">{value}</div>
    </div>
  );
}

function UsageCard({ endpoint, today, limit }: { endpoint: string; today: number; limit: number }) {
  const pct = Math.round((today / limit) * 100);
  return (
    <div className="rounded-xl border p-4 bg-card space-y-2">
      <div className="text-xs font-mono text-muted-foreground">{endpoint}</div>
      <div className="text-2xl font-bold">{today.toLocaleString()} <span className="text-sm text-muted-foreground font-normal">/ {limit.toLocaleString()}</span></div>
      <div className="w-full h-2 bg-muted rounded-full overflow-hidden"><div className="h-full bg-emerald-600 rounded-full" style={{ width: `${pct}%` }} /></div>
      <div className="text-xs text-muted-foreground">{pct}% of daily limit</div>
    </div>
  );
}
