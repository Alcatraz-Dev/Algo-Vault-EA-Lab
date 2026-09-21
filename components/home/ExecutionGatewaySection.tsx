"use client";

import Link from "next/link";
import {
  ArrowRight,
  Server,
  ShieldCheck,
  Terminal,
  Send,
  Download,
  FileCode2,
} from "lucide-react";

const GATEWAY_SPECS = [
  {
    label: "Transport",
    value: "HTTP REST · JSON",
    tone: "text-foreground",
  },
  {
    label: "Authentication",
    value: "Per-account token (Bearer)",
    tone: "text-info",
  },
  {
    label: "Terminal onboarding",
    value: "Register via EA with gateway token",
    tone: "text-foreground",
  },
  {
    label: "Account state",
    value: "/api/trading/gateway/status",
    tone: "text-positive",
  },
  {
    label: "Heartbeat",
    value: "/api/trading/gateway/heartbeat",
    tone: "text-positive",
  },
  {
    label: "Order dispatch",
    value: "commands + orders endpoints",
    tone: "text-foreground",
  },
  {
    label: "Latency",
    value: "Network-dependent — no fixed claim",
    tone: "text-muted-foreground",
  },
  {
    label: "Risk",
    value: "Pre-trade validation before dispatch",
    tone: "text-warning",
  },
];

const FLOW_NODES = [
  { label: "AlgoVault Web", caption: "Risk-approved intents", icon: Server },
  { label: "Gateway REST API", caption: "Bearer token", icon: Send },
  { label: "MT5 Terminal", caption: "MQL5 EA bridge", icon: Terminal },
  { label: "Broker", caption: "Live execution", icon: Download },
];

export default function ExecutionGatewaySection() {
  return (
    <section className="border-b border-border bg-background py-24 md:py-32">
      <div className="page-container">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-widest text-primary">
              Execution Infrastructure
            </p>
            <h2 className="mt-3 font-display text-4xl font-normal leading-[1.05] tracking-tight text-foreground md:text-5xl lg:text-6xl">
              The MT5 Gateway
              <br />
              <span className="text-primary">Arms-Length by Design</span>
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
              A small HTTP bridge connects the web platform to your MetaTrader terminal through a
              custom MQL5 Expert Advisor. The gateway dispatches risk-validated commands; connection
              state is reported by the terminal itself — never assumed.
            </p>
          </div>
          <Link
            href="/account/trading-access"
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition hover:text-primary md:mt-0"
          >
            Gateway Access
            <ArrowRight size={16} />
          </Link>
        </div>

        <div className="mt-10 rounded-lg border border-border bg-card p-6 shadow-sm md:p-8">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            {/* Flow + specs */}
            <div className="space-y-6 lg:col-span-7">
              <div className="grid grid-cols-2 gap-3 font-mono text-sm sm:grid-cols-4">
                {FLOW_NODES.map((node, idx) => {
                  const Icon = node.icon;
                  return (
                    <div
                      key={node.label}
                      className="relative rounded-lg border border-border bg-background/60 p-4 text-center"
                    >
                      <Icon size={16} className="mx-auto mb-1.5 text-primary" />
                      <div className="text-xs font-semibold text-foreground">
                        {idx + 1}. {node.label}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {node.caption}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-lg border border-border bg-background/60 p-5 font-mono text-sm">
                <div className="flex items-center justify-between border-b border-border/30 pb-2 text-muted-foreground">
                  <span className="font-semibold text-foreground">Gateway characteristics</span>
                  <span className="text-xs text-info">Reported, not assumed</span>
                </div>
                <dl className="mt-3 space-y-2">
                  {GATEWAY_SPECS.map((spec) => (
                    <div
                      key={spec.label}
                      className="flex items-center justify-between gap-3 text-xs sm:text-sm"
                    >
                      <dt className="text-muted-foreground">{spec.label}</dt>
                      <dd className={`text-right font-semibold ${spec.tone}`}>{spec.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                <ShieldCheck size={14} className="mt-0.5 shrink-0 text-positive" />
                MetaTrader requires WebRequest URLs to be whitelisted in the terminal. The EA
                registers itself, reports heartbeats, and only accepts commands that carry the
                gateway token.
              </p>
            </div>

            {/* MQL5 schematic */}
            <div className="rounded-lg border border-border bg-background/90 p-5 font-mono text-sm lg:col-span-5">
              <div className="flex items-center justify-between border-b border-border pb-2 text-muted-foreground">
                <span className="flex items-center gap-2 font-semibold text-foreground">
                  <FileCode2 size={14} className="text-positive" />
                  MQL5 EA Bridge — schematic
                </span>
                <span className="text-xs text-muted-foreground">AlgoVaultTradeGateway.mq5</span>
              </div>
              <div className="mt-3 space-y-1 overflow-x-auto rounded-md bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground no-scrollbar">
                <div>{`// OnTimer() — pull + execute`}</div>
                <div className="text-primary">input string GatewayToken = &quot;ag_...&quot;;</div>
                <div>{`int onInit() { EventSetTimer(1); return INIT_SUCCEEDED; }`}</div>
                <div>{`void OnTimer() {`}</div>
                <div className="pl-4">{`// 1. register/heartbeat`}</div>
                <div className="pl-4 text-positive">
                  {`WebRequest(gateway + "/heartbeat", ...);`}
                </div>
                <div className="pl-4">{`// 2. pull approved commands`}</div>
                <div className="pl-4 text-positive">{`WebRequest(gateway + "/commands", ...);`}</div>
                <div className="pl-4">{`// 3. execute + report back`}</div>
                <div className="pl-4 text-info">{`OrderSend(...);`}</div>
                <div>{`}`}</div>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  Full installable EA ships with your gateway token.
                </span>
                <Link
                  href="/account/trading-access"
                  className="flex items-center gap-1 font-semibold text-primary hover:underline"
                >
                  <Download size={12} />
                  Get the EA
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}