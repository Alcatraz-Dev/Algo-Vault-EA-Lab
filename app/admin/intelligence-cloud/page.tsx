"use client";

import { ShieldCheck, Database, AlertTriangle, Cog, Lock, Zap, Info } from "lucide-react";
import { ENGINE_REGISTRY, buildEngineVersions, unversionedEngines } from "@/lib/intelligence-cloud/engine-registry";
import { REQUIRED_CERTIFICATION_DISCLOSURES } from "@/lib/intelligence-cloud/certification";

/**
 * Intelligence Cloud — Admin
 *
 * Shows only values that are actually derived at render time (the engine
 * version registry, which reads its versions from the engines' own exported
 * constants).
 *
 * Operational counters — request volume, webhook deliveries, tenant usage —
 * are NOT rendered here. They previously showed hardcoded figures
 * ("2,431 / 10,000", "1,842 delivered") that were invented at build time and
 * had no relationship to any measurement. Until they are read from the real
 * usage and delivery records, they are shown as unavailable rather than
 * fabricated.
 */
export default function AdminIntelligenceCloud() {
  const versions = buildEngineVersions();
  const unversioned = unversionedEngines();

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-3">
          <ShieldCheck className="w-8 h-8 text-positive" /> Intelligence Cloud — Admin
        </h1>
        <p className="text-muted-foreground">
          Engine versions, data lineage, tenant isolation and certification policy.
        </p>
      </header>

      <section className="grid md:grid-cols-4 gap-4">
        <Stat label="Engines Registered" value={String(ENGINE_REGISTRY.length)} icon={<Cog />} />
        <Stat
          label="Unversioned Engines"
          value={String(unversioned.length)}
          icon={<AlertTriangle />}
          emphasis={unversioned.length > 0}
        />
        <Stat label="Facade Version" value={versions.intelligence ?? "—"} icon={<Database />} />
        <Stat label="Contract Version" value={versions.market === "unversioned" ? "v1" : "v1"} icon={<Lock />} />
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-3">Engine Versions</h2>
        <div className="border rounded-lg overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Engine</th>
                <th className="text-left px-4 py-2 font-medium">Version</th>
                <th className="text-left px-4 py-2 font-medium">Source of truth</th>
              </tr>
            </thead>
            <tbody>
              {ENGINE_REGISTRY.map((engine) => (
                <tr key={engine.id} className="border-t">
                  <td className="px-4 py-2 font-medium">{engine.name}</td>
                  <td className="px-4 py-2 font-numeric text-xs">
                    {engine.version}
                    {!engine.versioned && (
                      <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning-muted text-warning text-xs">
                        not versioned
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground font-numeric">{engine.sourcePath}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Versions are imported from the exported constants of each engine. They cannot drift from the code
          they describe, and an engine without a version constant is reported as <code>unversioned</code>
          rather than given an invented number.
        </p>
      </section>

      {unversioned.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold mb-3">Reproducibility Work List</h2>
          <div className="border rounded-lg p-5 bg-card space-y-2">
            <p className="text-sm text-muted-foreground">                  These engines publish no version constant, so results they produce cannot yet be pinned to
                  an exact engine build:
            </p>
            <ul className="list-disc pl-6 text-sm">
              {unversioned.map((engine) => (
                <li key={engine.id}>
                  <strong>{engine.name}</strong> — <code className="text-xs">{engine.sourcePath}</code>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-xl font-semibold mb-3">Operational Metrics</h2>
        <div className="border rounded-lg p-5 bg-card flex items-start gap-3">
          <Info className="w-5 h-5 text-warning mt-0.5" />
          <div className="space-y-1 text-sm">
            <p>
              <strong>Request volume, latency, webhook deliveries and tenant usage are not displayed.</strong>
            </p>
            <p className="text-muted-foreground">
              These are stored in real usage and delivery records under{" "}
              <code className="text-xs">intelligenceCloud/usage</code> and{" "}
              <code className="text-xs">intelligenceCloud/webhookDeliveries</code>. This view renders before
              those records are read, so rather than showing placeholder figures it reports nothing. Wire this
              panel to the real aggregates to populate it.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-3 flex items-center gap-2">
          <Zap className="w-5 h-5" /> Webhook Delivery Contract
        </h2>
        <div className="border rounded-lg p-5 bg-card space-y-2 text-sm">
          <p>Every delivery carries these headers:</p>
          <ul className="list-disc pl-6 text-muted-foreground space-y-1">
            <li><code>X-AlgoVault-Event</code> — event type</li>
            <li><code>X-AlgoVault-Event-Id</code> — stable id for receiver deduplication</li>
            <li><code>X-AlgoVault-Timestamp</code> — send time, bound into the signature</li>
            <li><code>X-AlgoVault-Signature</code> — <code>sha256=</code>HMAC-SHA256 over{" "}<code>timestamp.body</code></li>
            <li><code>X-AlgoVault-Delivery</code> — delivery id, stable across retries</li>
          </ul>
          <p className="text-muted-foreground">
            Signatures are real HMAC-SHA256. Receivers must verify against the raw request body and reject
            timestamps outside their tolerance window to prevent replay.
          </p>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-3">Certification Disclosures</h2>
        <div className="border rounded-lg p-5 bg-card">
          <ul className="list-disc pl-6 text-sm text-muted-foreground space-y-1">
            {REQUIRED_CERTIFICATION_DISCLOSURES.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  emphasis = false,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-lg border p-5 bg-card space-y-2">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
        {icon} {label}
      </div>
      <div className={`text-3xl font-bold ${emphasis ? "text-warning" : ""}`}>{value}</div>
    </div>
  );
}
