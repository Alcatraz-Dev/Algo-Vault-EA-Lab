"use client";

import { useState } from "react";
import { Shield, Key, Activity, Terminal, BookOpen, Code2, Zap, CheckCircle2, AlertCircle, BarChart3 } from "lucide-react";
import Link from "next/link";

export default function IntelligenceCloudOverview() {
  const [expanded, setExpanded] = useState<string | null>("overview");

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Intelligence Cloud</h1>
        <p className="text-muted-foreground">AlgoVault's deterministic intelligence layer — market, indicators, smart money, strategy validation, and research — exposed through versioned APIs.</p>
      </header>

      <section className="grid md:grid-cols-3 gap-4">
        <Card title="Market Intelligence" icon={<Activity />} desc="Market state, structure, regime, session, liquidity. Deterministic and versioned." endpoint="/api/intelligence/v2/market/state" />
        <Card title="Indicators" icon={<BarChart3 />} desc="Indicator snapshots with source versions and signals." endpoint="/api/intelligence/v2/indicators" />
        <Card title="Smart Money" icon={<Zap />} desc="SMC state, premium/discount, FVG, order blocks, session analysis." endpoint="/api/intelligence/v2/smart-money" />
      </section>

      <section className="grid md:grid-cols-3 gap-4">
        <Card title="Strategy Validation" icon={<Shield />} desc="Validate strategy definitions using canonical strategy-engine." endpoint="/api/intelligence/v2/strategy/validate" />
        <Card title="Research Jobs" icon={<Terminal />} desc="Submit async research: backtest, walk-forward, Monte Carlo, OOS." endpoint="/api/intelligence/v2/research/jobs" />
        <Card title="SDK Contracts" icon={<Code2 />} desc="Conceptual contracts for TypeScript / Python SDK integration." endpoint="#sdk" />
      </section>

      <section className="border rounded-lg p-6 bg-card space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2"><BookOpen className="w-5 h-5" /> API Contracts & Versioning</h2>
        <p>Every response includes <code>apiVersion</code>, <code>engineVersions</code>, <code>dataTimestamp</code>, and optional <code>dataLineage</code>. Snapshots are immutable by reference.</p>
        <ul className="list-disc pl-6 text-sm text-muted-foreground space-y-1">
          <li><strong>v2</strong> — current intelligence API version</li>
          <li>Engine versions tracked centrally: market-data, indicator-engine, smart-money, strategy-engine, backtest, risk, research, ai-configuration</li>
          <li>Certification rotates; does not guarantee performance</li>
          <li>All responses state limitations and assumptions</li>
        </ul>
      </section>

      <section className="border rounded-lg p-6 bg-card space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2"><Key className="w-5 h-5" /> Authentication & Scopes</h2>
        <div className="grid md:grid-cols-2 gap-3 text-sm">
          {[
            "market:read", "indicators:read", "smartmoney:read", "setups:read",
            "research:read", "research:create", "strategy:validate", "backtest:create",
            "strategy:read", "journal:read"
          ].map((s) => (
            <div key={s} className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted"><CheckCircle2 className="w-3.5 h-3.5 text-positive" /> <code className="text-xs">{s}</code></div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Execution scopes (execution:prepare / approve / live) are separate and disabled by default.</p>
      </section>

      <section id="sdk" className="border rounded-lg p-6 bg-card space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2"><Code2 className="w-5 h-5" /> SDK Concept</h2>
        <pre className="text-xs bg-background text-positive rounded-lg p-4 overflow-x-auto">
{`const client = createSDK({ apiKey: "av_key_...", baseUrl: "https://api.algovault.io/intelligence/v2" });
const market = await client.market.intelligence({ symbol: "XAUUSD", timeframe: "5m", context: { smartMoney: true } });
console.log(market.smartMoney, market.indicators, market.engineVersions);`}
        </pre>
        <p className="text-sm text-muted-foreground">The SDK must call public APIs. It never replicates intelligence logic locally.</p>
      </section>
    </div>
  );
}

function Card({ title, icon, desc, endpoint }: { title: string; icon: React.ReactNode; desc: string; endpoint: string }) {
  return (
    <Link href="#" className="block rounded-lg border p-5 bg-card hover:border-foreground/20 transition-colors space-y-2">
      <div className="flex items-center gap-2 text-lg font-semibold">{icon} {title}</div>
      <p className="text-sm text-muted-foreground">{desc}</p>
      <code className="text-xs text-positive font-numeric">{endpoint}</code>
    </Link>
  );
}
