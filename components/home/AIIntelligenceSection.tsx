"use client";

import Link from "next/link";
import {
  ArrowRight,
  Brain,
  FunctionSquare,
  ShieldCheck,
  GitBranch,
  Layers,
  EyeOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

const DETERMINISTIC_ENGINES = [
  {
    name: "Regime Classification",
    desc: "Trend, range, or momentum classification computed from real OHLC features.",
  },
  {
    name: "Market Structure",
    desc: "Swing highs/lows, breaks, and structural events detected bar by bar.",
  },
  {
    name: "Institutional Zones",
    desc: "Order blocks and fair value gaps mapped from confirmed structure.",
  },
  {
    name: "Liquidity Map",
    desc: "Session highs/lows and sweep targets tracked as reference levels.",
  },
  {
    name: "VWAP Anchoring",
    desc: "Session-rolled volume-weighted anchor with price position.",
  },
  {
    name: "Session Analytics",
    desc: "London / New York / Tokyo participation windows from real timestamps.",
  },
  {
    name: "Volume & Volatility",
    desc: "Relative volume and ATR-based volatility regime.",
  },
  {
    name: "Market Score",
    desc: "A weighted composite of the engines above, 0–100.",
  },
];

const AI_CAPABILITIES = [
  {
    title: "Confluence Summary",
    desc: "States which deterministic edges agree, and where they conflict — citing each engine.",
  },
  {
    title: "Scenario Narrative",
    desc: "A conditional read of structure: what confirms the setup, what invalidates it.",
  },
  {
    title: "Parameter Suggestion",
    desc: "Starting-value proposals for strategy rules, derived from observed volatility.",
  },
  {
    title: "Execution Recommendation",
    desc: "A controlled directional recommendation that must still pass the risk validator.",
  },
];

const AI_NEVER_DOES = [
  "Invent metrics or price data the engines did not produce.",
  "Report win rates, accuracy, or confidence percentages without a defined, computed basis.",
  "Hide the deterministic data behind the summary — every claim is traceable.",
  "Send orders on its own. Execution is a separate, risk-gated service.",
  "Pretend to replace the backtest or the risk engine.",
];

export default function AIIntelligenceSection() {
  return (
    <section className="border-b border-border bg-background py-16 md:py-24">
      <div className="page-container">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-widest text-accent">
              Intelligence Stack
            </p>
            <h2 className="mt-3 font-display text-4xl md:text-5xl lg:text-6xl font-medium leading-[1.05] tracking-tight text-text-primary">
              Deterministic First.
              <br />
              <span className="text-accent">AI Interpreted on Top.</span>
            </h2>
            <p className="mt-4 max-w-2xl text-body md:text-body-lg leading-relaxed text-text-secondary">
              AlgoVault separates computed facts from model interpretation. The deterministic layer
              is reproducible from the same candles; the AI layer explains, contextualizes, and
              recommends — it never fabricates what the engines did not produce.
            </p>
          </div>
          <Link
            href="/strategy-lab"
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary"
          >
            Open Strategy Lab
            <ArrowRight size={16} />
          </Link>
        </div>

        {/* Two-layer architecture */}
        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Deterministic layer */}
          <Card variant="elevated" size="lg">
            <CardHeader>
              <div className="flex items-start gap-3">
                <Badge variant="success" className="h-9 w-9 shrink-0 flex items-center justify-center rounded-input px-0">
                  <FunctionSquare size={16} />
                </Badge>
                <div>
                  <CardTitle className="text-body font-semibold">Deterministic Layer — computed, not guessed</CardTitle>
                  <CardDescription className="mt-1">
                    Eight pure engines run on the market feed. Same candles in, same result out.
                    Nothing here depends on a model.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {DETERMINISTIC_ENGINES.map((engine) => (
                  <li
                    key={engine.name}
                    className="flex items-start justify-between gap-4 rounded-input border border-border bg-surface-muted p-3"
                  >
                    <span className="text-body-sm font-medium text-text-primary">{engine.name}</span>
                    <span className="max-w-[46%] text-right text-meta leading-relaxed text-text-secondary">
                      {engine.desc}
                    </span>
                  </li>
                ))}
              </ul>
              <Badge variant="success" className="mt-4 flex items-center gap-1.5 text-meta font-mono">
                <ShieldCheck size={13} />
                Deterministic — reproducible from raw candles
              </Badge>
            </CardContent>
          </Card>

          {/* AI interpretation layer */}
          <Card variant="elevated" size="lg">
            <CardHeader>
              <div className="flex items-start gap-3">
                <Badge variant="warning" className="h-9 w-9 shrink-0 flex items-center justify-center rounded-input px-0">
                  <Brain size={16} />
                </Badge>
                <div>
                  <CardTitle className="text-body font-semibold">AI Interpretation Layer — applied on top</CardTitle>
                  <CardDescription className="mt-1">
                    The model reads the deterministic output and turns it into a decision-grade
                    brief. Every recommendation remains traceable to the data behind it.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2.5">
                {AI_CAPABILITIES.map((cap) => (
                  <li
                    key={cap.title}
                    className="rounded-input border border-border bg-surface-muted p-3"
                  >
                    <p className="flex items-center gap-2 text-body-sm font-semibold text-text-primary">
                      <GitBranch size={13} className="text-warning" />
                      {cap.title}
                    </p>
                    <p className="mt-1 pl-5 text-meta leading-relaxed text-text-secondary">
                      {cap.desc}
                    </p>
                  </li>
                ))}
              </ul>
              <Badge variant="warning" className="mt-4 flex items-center gap-1.5 text-meta font-mono">
                <Layers size={13} />
                Interpretation only — cannot override deterministic risk checks
              </Badge>
            </CardContent>
          </Card>
        </div>

        {/* Honest boundary panel */}
        <Card variant="danger" size="lg" className="mt-6">
          <CardHeader>
            <div className="flex items-start gap-3">
              <Badge variant="destructive" className="h-9 w-9 shrink-0 flex items-center justify-center rounded-input px-0">
                <EyeOff size={16} />
              </Badge>
              <div>
                <CardTitle className="text-body font-semibold">What AlgoVault AI never does</CardTitle>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {AI_NEVER_DOES.map((rule) => (
                <li
                  key={rule}
                  className="flex items-start gap-2 text-body-sm leading-relaxed text-text-secondary"
                >
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-text-muted/60" />
                  {rule}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}