"use client";

import Link from "next/link";
import {
  ArrowRight,
  ShieldCheck,
  AlertOctagon,
  Route,
  XCircle,
} from "lucide-react";

const PIPELINE_NODES = [
  {
    number: "01",
    name: "Market",
    desc: "Provider candles feed deterministic analysis.",
  },
  {
    number: "02",
    name: "Signal",
    desc: "Strategy rules produce a directional intent.",
  },
  {
    number: "03",
    name: "Risk",
    desc: "The risk engine validates volume, SL/TP, and limits.",
  },
  {
    number: "04",
    name: "Order",
    desc: "Approved intents become market, limit, or stop orders.",
  },
  {
    number: "05",
    name: "Gateway",
    desc: "An authenticated endpoint forwards the command.",
  },
  {
    number: "06",
    name: "MT5",
    desc: "The MQL5 Expert Advisor receives and re-validates.",
  },
  {
    number: "07",
    name: "Execution",
    desc: "Broker fill with a full audit trail.",
  },
];

const LIVE_PATH = [
  "NEW",
  "PENDING_ENTRY",
  "ENTRY_TRIGGERED",
  "TP1_REACHED",
  "TP2_REACHED",
  "TP3_REACHED",
  "CLOSED",
];

const TERMINAL_STATES = [
  "STOPPED_OUT",
  "EXPIRED",
  "CANCELLED",
  "INVALIDATED",
  "OUTCOME_AMBIGUOUS",
];

const RISK_RULES = [
  {
    rule: "Broker lot limits enforced",
    detail: "Volume clamped to min/max lot and rounded to the broker lot step.",
  },
  {
    rule: "Stop loss mandatory",
    detail: "Entries without a defined SL are rejected — SL_REQUIRED.",
  },
  {
    rule: "Daily loss limit",
    detail: "New entries blocked once today's realized loss breaches the limit.",
  },
  {
    rule: "Max drawdown guard",
    detail: "Drawdown beyond the configured percent halts new entries.",
  },
  {
    rule: "Max open positions",
    detail: "Concurrency capped per account.",
  },
  {
    rule: "Symbol exposure cap",
    detail: "Maximum open lots per single symbol enforced.",
  },
  {
    rule: "Cooldown between orders",
    detail: "Minimum seconds between executions — COOLDOWN_ACTIVE.",
  },
  {
    rule: "Emergency stop",
    detail: "Protective actions always approved; new entries blocked.",
  },
  {
    rule: "Market-entry policy",
    detail: "MARKET entries can be disabled — orders then require a defined price.",
  },
  {
    rule: "Position sizing",
    detail: "Volume sized from account equity, risk %, and SL distance.",
  },
];

export default function SignalRiskSection() {
  return (
    <section className="border-b border-border bg-background py-24 md:py-32">
      <div className="page-container">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-widest text-primary">
              Execution Pipeline
            </p>
            <h2 className="mt-3 font-display text-4xl font-normal leading-[1.05] tracking-tight text-foreground md:text-5xl lg:text-6xl">
              Signal Lifecycle
              <br />
              <span className="text-primary">&amp; Risk Validation</span>
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
              Every signal flows through a deterministic risk validator before the gateway may act
              on it. The risk engine approves or rejects — it does not guess, and it never fabricates
              account state.
            </p>
          </div>
          <Link
            href="/signals"
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition hover:text-primary md:mt-0"
          >
            Signal Console
            <ArrowRight size={16} />
          </Link>
        </div>

        {/* Pipeline */}
        <div className="mt-10 rounded-lg border border-border bg-card p-6 shadow-sm md:p-8">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">
            <Route size={14} className="text-primary" />
            Seven-node pipeline — nothing reaches MT5 outside this path
          </div>
          <ol className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
            {PIPELINE_NODES.map((node) => (
              <li
                key={node.number}
                className="flex flex-col gap-1 rounded-md border border-border bg-background/60 p-3.5"
              >
                <span className="font-mono text-[11px] font-bold text-primary">{node.number}</span>
                <span className="text-sm font-semibold text-foreground">{node.name}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {node.desc}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Signal lifecycle states */}
          <div className="rounded-lg border border-border bg-card p-6 lg:col-span-5 md:p-8">
            <h3 className="text-base font-semibold text-foreground">
              Canonical signal lifecycle
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              One status vocabulary across signals, monitoring, and outcomes — never arbitrary colors.
            </p>
            <div className="mt-5 space-y-4">
              <div>
                <p className="font-mono text-xs font-semibold uppercase tracking-widest text-positive">
                  Active path
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {LIVE_PATH.map((state, idx) => (
                    <span
                      key={state}
                      className="inline-flex items-center gap-1 rounded-full border border-positive/30 bg-positive/10 px-2.5 py-0.5 text-xs font-medium text-positive"
                    >
                      {idx < LIVE_PATH.length - 1 && (
                        <span className="text-positive/40">→</span>
                      )}
                      {state}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <p className="font-mono text-xs font-semibold uppercase tracking-widest text-negative">
                  Terminal states
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {TERMINAL_STATES.map((state) => (
                    <span
                      key={state}
                      className="inline-flex items-center gap-1 rounded-full border border-negative/30 bg-negative/10 px-2.5 py-0.5 text-xs font-medium text-negative"
                    >
                      <XCircle size={11} />
                      {state}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Real risk rules */}
          <div className="rounded-lg border border-border bg-card p-6 lg:col-span-7 md:p-8">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-warning/30 bg-warning/10 text-warning">
                <ShieldCheck size={16} />
              </span>
              <div>
                <h3 className="text-base font-semibold text-foreground">The risk engine, as built</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  These are the guards implemented in the platform risk engine — applied to every
                  order intent before dispatch.
                </p>
              </div>
            </div>
            <ul className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {RISK_RULES.map((item) => (
                <li
                  key={item.rule}
                  className="rounded-md border border-border bg-background/60 px-3.5 py-2.5"
                >
                  <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <span className="h-1 w-1 rounded-full bg-warning" />
                    {item.rule}
                  </p>
                  <p className="mt-0.5 pl-2.5 text-xs leading-relaxed text-muted-foreground">
                    {item.detail}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-5 flex items-center gap-1.5 text-xs font-mono text-warning">
              <AlertOctagon size={13} />
              Rejected intents carry a decision code — surfaced, not hidden
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}