"use client";

import { useIntelligenceOS } from "@/lib/intelligence-os/client";
import { cn } from "@/lib/utils";
import { ShieldAlert, Clock, AlertTriangle, Loader2, TrendingUp, Settings, GitBranch, ShieldCheck, Activity } from "lucide-react";
import Link from "next/link";
import type { IntelligenceEvent } from "@/lib/intelligence-os/types";
import { getPriorityLabel, getPriorityReason } from "@/lib/intelligence-os/priority";
import { SystemHealthStrip } from "./SystemHealthStrip";

export function HomeIntelligenceOS({ refreshKey }: { refreshKey: number }) {
  const contextState = useIntelligenceOS(refreshKey);
  const context = contextState.status === "ready" ? contextState.context : null;

  if (contextState.status === "loading") {
    return <HomeIntelligenceOSSkeleton />;
  }

  if (contextState.status === "unavailable") {
    return (
      <section className="rounded-xl border border-dashed border-border/50 bg-muted/20 p-4 text-sm text-muted-foreground">
        Intelligence OS unavailable: {contextState.reason}
      </section>
    );
  }

  return (
    <section className="space-y-4" data-guide="home-intelligence-os">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-foreground">AlgoVault Intelligence OS</h2>
            <p className="text-xs text-muted-foreground">{
              context?.research?.activeMissions.some((m: any) => m.status === "running") ? "Research in progress — research-forward view active." : "Context-aware trading dashboard."
            }</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SystemHealthStrip context={context} />
        </div>
      </header>

      {/* MARKET PULSE */}
      <section className="rounded-lg border border-border bg-card p-4" data-guide="market-pulse">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Market Pulse</h3>
        </div>
        <p className="mt-2 text-sm text-foreground">
          {context?.market.symbol ? `${context.market.symbol} · ${context.market.timeframe ?? "M5"}` : "No market selected"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {context?.market.session ? `Session ${context.market.session}` : "No session"} ·
          {context?.market.regime ? `Regime ${context.market.regime}` : "No regime"} ·
          {context?.market.volatility ? `Vol ${context.market.volatility.state}` : "No volatility"}
        </p>
      </section>

      {/* WHAT MATTERS NOW */}
      <section className="rounded-lg border border-border bg-card p-4" data-guide="what-matters-now">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">What Matters Now</h3>
        </div>
        <ul className="mt-3 space-y-2">
          {context?.whatMattersNow
            .filter((e: any) => e.priority === "CRITICAL" || e.priority === "HIGH")
            .slice(0, 8)
            .map((event: any) => (
              <EventItem key={event.id} event={event} />
            ))}
        </ul>
        {(!context?.whatMattersNow || context.whatMattersNow.length === 0) && (
          <p className="mt-3 text-xs text-muted-foreground">Nothing requiring attention right now.</p>
        )}
      </section>

      {/* ACTIVE SETUPS */}
      <section className="rounded-lg border border-border bg-card p-4" data-guide="active-setups">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Active Setups</h3>
          <span className="ml-auto text-xs text-muted-foreground">{context?.setups?.activeCount ?? 0} active</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {context?.setups?.confirmedCount ? `${context.setups.confirmedCount} confirmed` : "No confirmed setups"}
        </p>
        {context?.setups?.records.length ? (
          <ul className="mt-2 space-y-1">
            {context.setups.records.slice(0, 5).map((record: any) => (
              <li key={record.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{record.id}</span>
                <span>{record.symbol ?? "—"}</span>
                <span>{record.timeframe ?? "—"}</span>
                <span>{record.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">No setups tracked.</p>
        )}
      </section>

      {/* STRATEGY HEALTH */}
      <section className="rounded-lg border border-border bg-card p-4" data-guide="strategy-health">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Strategy Health</h3>
          <span className="ml-auto text-xs text-muted-foreground">{context?.strategies?.degradedCount ?? 0} degraded</span>
        </div>
        {context?.strategies?.items.length ? (
          <ul className="mt-2 space-y-1">
            {context.strategies.items.slice(0, 5).map((strategy: any) => (
              <li key={strategy.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{strategy.name}</span>
                <span>{strategy.health}</span>
                <span>{strategy.mode}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">No strategies available.</p>
        )}
      </section>

      {/* RESEARCH */}
      <section className="rounded-lg border border-border bg-card p-4" data-guide="research">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Research</h3>
          <span className="ml-auto text-xs text-muted-foreground">{context?.research?.activeMissions.length ?? 0} missions</span>
        </div>
        {context?.research?.activeMissions.length ? (
          <ul className="mt-2 space-y-1">
            {context.research.activeMissions.slice(0, 5).map((mission: any) => (
              <li key={mission.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{mission.name}</span>
                <span>{mission.status}</span>
                <span>{mission.survivorCount ?? 0} survivors</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">No research missions.</p>
        )}
      </section>

      {/* RISK */}
      <section className="rounded-lg border border-border bg-card p-4" data-guide="risk">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Risk</h3>
          <span className={cn("ml-auto uppercase", riskClass(context?.risk?.status))}>{context?.risk?.status ?? "unknown"}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {context?.risk?.account?.balance != null ? `Balance ${context.risk.account.balance}` : "No balance"}{" "}
          · {context?.risk?.account?.equity != null ? `Equity ${context.risk.account.equity}` : "No equity"}
        </p>
        {context?.risk?.limits && (
          <p className="mt-1 text-xs text-muted-foreground">
            {context.risk.limits.maxDrawdownPercent != null ? `Max DD ${context.risk.limits.maxDrawdownPercent}%` : "No max DD"}
            {context.risk.limits.maxOpenPositions != null ? ` · Max positions ${context.risk.limits.maxOpenPositions}` : ""}
          </p>
        )}
      </section>

      {/* AI INSIGHT */}
      <section className="rounded-lg border border-border bg-card p-4" data-guide="ai-insight">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">AI Insight</h3>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {context?.ai?.dossier ? "AI context available from existing engines." : "No AI context yet."}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {context?.ai?.lastInsight ?? "Summarize the deterministic state when asked."}
        </p>
      </section>

      {/* RECENT ACTIVITY */}
      <section className="rounded-lg border border-border bg-card p-4" data-guide="recent-activity">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recent Activity</h3>
        </div>
        {context?.productUsage?.recentActivity.length ? (
          <ul className="mt-2 space-y-1">
            {context.productUsage.recentActivity.slice(0, 8).map((item: any) => (
              <li key={item.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{new Date(item.timestamp).toLocaleTimeString()}</span>
                <span>{item.title}</span>
                {item.href ? (
                  <Link href={item.href} className="text-primary underline underline-offset-2">view</Link>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">No recent activity.</p>
        )}
      </section>
    </section>
  );
}

function HomeIntelligenceOSSkeleton() {
  return (
    <section className="space-y-4" data-guide="home-intelligence-os-skeleton">
      <div className="flex items-center gap-2">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <h2 className="h-6 w-48 animate-pulse rounded bg-muted" />
      </div>
      {[...Array(7)].map((_, i) => (
        <div key={i} className="h-28 animate-pulse rounded-lg border border-border/60 bg-muted/30" />
      ))}
    </section>
  );
}

function EventItem({ event }: { event: IntelligenceEvent }) {
  const label = getPriorityLabel(event.priority);
  const reason = getPriorityReason(event.priority);

  return (
    <li className="flex items-start gap-3 rounded-lg border border-border/50 bg-muted/20 p-3 text-sm">
      <div className="mt-0.5 shrink-0">
        <span className={cn("rounded-full px-1.5 py-0.5 text-micro font-medium uppercase", priorityClass(event.priority))}>
          {label}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{event.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{event.summary}</p>
        {event.evidence && event.evidence.length > 0 && (
          <p className="mt-1 text-micro text-muted-foreground">Evidence: {event.evidence.slice(0, 2).join("; ")}</p>
        )}
        <p className="mt-1 text-micro text-muted-foreground">{reason}</p>
        {event.actions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {event.actions.slice(0, 3).map((action) => (
              <ActionButton key={action.id} action={action} />
            ))}
          </div>
        )}
      </div>
      <span className="shrink-0 text-micro text-muted-foreground">
        {new Date(event.timestamp).toLocaleTimeString()}
      </span>
    </li>
  );
}

function ActionButton({ action }: { action: IntelligenceEvent["actions"][0] }) {
  const isRoute = action.target.kind === "route";
  if (isRoute) {
    const routeTarget = action.target as { kind: "route"; href: string };
    return (
      <Link
        href={routeTarget.href}
        className="text-micro underline underline-offset-2 decoration-muted-foreground hover:decoration-foreground"
      >
        {action.label}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className="text-micro underline underline-offset-2 decoration-muted-foreground hover:decoration-foreground"
      onClick={() => {
        // Contextual action dispatch — see lib/intelligence-os/types.ts §B.
      }}
    >
      {action.label}
    </button>
  );
}

function priorityClass(p: IntelligenceEvent["priority"]): string {
  return p === "CRITICAL" ? "bg-destructive-muted text-destructive-foreground" : p === "HIGH" ? "bg-warning-muted text-warning-foreground" : p === "MEDIUM" ? "bg-warning/10 text-warning-foreground" : p === "LOW" ? "bg-info-muted text-info-foreground" : "bg-muted text-muted-foreground";
}

function riskClass(status?: string): string {
  if (status === "normal") return "text-positive";
  if (status === "caution") return "text-warning";
  if (status === "restricted") return "text-warning";
  if (status === "halted") return "text-negative";
  return "text-muted-foreground";
}
