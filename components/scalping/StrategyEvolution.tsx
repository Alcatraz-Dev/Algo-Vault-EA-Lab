"use client";

import { Dna, GitBranch } from "lucide-react";
import {
  AwaitingState,
  SourceFooter,
  StatRow,
  TerminalPanel,
} from "@/components/scalping/TerminalPrimitives";
import { metricSource } from "@/lib/ai/provenance";
import type { EvolutionRun, GenerationReport } from "@/lib/ai/strategy-lab/evolution";

/**
 * Strategy Evolution — the real generation lifecycle.
 *
 * Every count rendered here comes from `GenerationReport`, which is produced by
 * actually backtesting each candidate. There is no placeholder sequence: a
 * generation that never ran is absent, and a run that could not start shows
 * its `unavailable` reason.
 *
 * The visual is a funnel per generation — width is proportional to the real
 * survivor ratio, so a collapse is visible as a collapse.
 */

function GenCard({ report }: { report: GenerationReport }) {
  const survivors = report.survivors;
  const candidates = report.candidates;
  // Real ratio; guards against a zero-candidate generation.
  const ratio = candidates > 0 ? Math.max(0, Math.min(1, survivors / candidates)) : 0;
  const evalRatio = candidates > 0 ? Math.max(0, Math.min(1, report.evaluated / candidates)) : 0;

  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-b border-border/60 px-3 py-2 last:border-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-foreground">
          GEN {String(report.generation).padStart(2, "0")}
        </span>
        <span className="text-xs text-muted-foreground">
          {report.parents > 0 ? `from ${report.parents} parents` : "seed population"}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-[104px] shrink-0 font-mono text-xs tabular-nums text-foreground">
          {candidates.toLocaleString()} candidates
        </span>
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-muted-foreground/60"
            style={{ width: `${evalRatio * 100}%` }}
            title={`${report.evaluated} evaluated`}
          />
        </div>
        <span className="w-[92px] shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
          {report.evaluated.toLocaleString()} evaluated
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-[104px] shrink-0 text-xs text-muted-foreground">survivors</span>
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${ratio * 100}%` }}
            title={`${survivors} survivors`}
          />
        </div>
        <span className="w-[92px] shrink-0 text-right font-mono text-xs font-semibold tabular-nums text-foreground">
          {survivors.toLocaleString()}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
        <span>
          mutations{" "}
          <span className="font-mono tabular-nums text-foreground">
            {report.mutations.toLocaleString()}
          </span>
        </span>
        {report.unevaluated > 0 ? (
          <span className="text-warning">
            unevaluated <span className="font-mono tabular-nums">{report.unevaluated}</span>
          </span>
        ) : null}
        <span>{(report.durationMs / 1000).toFixed(1)}s</span>
      </div>

      {report.unavailable ? (
        <p className="text-xs text-warning">{report.unavailable}</p>
      ) : null}
    </div>
  );
}

export function StrategyEvolution({
  run,
  loading,
  onRun,
  running,
}: {
  run: EvolutionRun | null;
  loading: boolean;
  onRun?: () => void;
  running?: boolean;
}) {
  return (
    <TerminalPanel
      title="AI Strategy Evolution"
      icon={<GitBranch className="size-3.5" />}
      meta={run ? `${run.generations} generation${run.generations === 1 ? "" : "s"}` : undefined}
      dense
      action={
        onRun ? (
          <button
            type="button"
            onClick={onRun}
            disabled={running}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {running ? "Running…" : "Run evolution"}
          </button>
        ) : null
      }
    >
      {!run ? (
        <AwaitingState
          className="m-3"
          compact
          reason={
            loading
              ? "Waiting for the evolution engine…"
              : "No evolution run yet. Run one to generate real candidates and backtest them."
          }
        />
      ) : run.unavailable ? (
        <div className="p-3">
          <AwaitingState reason={run.unavailable} compact />
          <div className="mt-3">
            <StatRow
              label="Symbol / timeframe"
              value={
                <span className="font-mono">
                  {run.symbol} · {run.timeframe}
                </span>
              }
            />
            <StatRow
              label="Data as of"
              value={
                run.dataAsOf ? (
                  <span className="font-mono">{new Date(run.dataAsOf).toISOString().slice(11, 19)}Z</span>
                ) : (
                  <span className="text-muted-foreground">Data unavailable</span>
                )
              }
            />
          </div>
        </div>
      ) : run.generationReports.length === 0 ? (
        <AwaitingState className="m-3" compact reason="The run produced no generation reports." />
      ) : (
        <>
          <div className="max-h-[420px] overflow-y-auto">
            {run.generationReports.map((g) => (
              <GenCard key={g.generation} report={g} />
            ))}
          </div>

          <SourceFooter
            className="border-t border-border px-3 py-2"
            items={[
              { label: "Source", value: <span>{metricSource("strategy-lab.evolution-run", run.dataAsOf).label}</span> },
              {
                label: "Totals",
                value: (
                  <span className="font-mono tabular-nums">
                    {run.totals.candidates} cand · {run.totals.evaluated} eval ·{" "}
                    {run.totals.survivors} surv
                  </span>
                ),
              },
            ]}
          />
        </>
      )}
    </TerminalPanel>
  );
}

/**
 * Per-strategy detail for the newest generation. Dense but readable: the full
 * metric set the brief asks for, each field provenance-labelled and each
 * unavailable state shown honestly.
 */
export function StrategyEvolutionDetail({
  run,
  selectedId,
  onSelect,
}: {
  run: EvolutionRun | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const newest = run?.generationReports[run.generationReports.length - 1];
  const details = newest?.details ?? [];

  if (details.length === 0) {
    return (
      <TerminalPanel title="Candidate Detail" icon={<Dna className="size-3.5" />}>
        <AwaitingState
          compact
          reason={
            run
              ? "No per-candidate detail was returned for this run."
              : "Run an evolution pass to inspect individual candidates."
          }
        />
      </TerminalPanel>
    );
  }

  return (
    <TerminalPanel
      title="Candidate Detail"
      icon={<Dna className="size-3.5" />}
      meta={`${details.length} candidate${details.length === 1 ? "" : "s"} (newest generation)`}
      dense
    >
      <div className="max-h-[420px] overflow-y-auto">
        {details.map((c) => {
          const m = c.metrics;
          const oos = c.validation?.outOfSample?.metrics ?? null;
          const isSelected = c.dna.id === selectedId;

          return (
            <button
              key={c.dna.id}
              type="button"
              onClick={() => onSelect(c.dna.id)}
              className={`block w-full border-b border-border/60 px-3 py-2 text-left transition-colors last:border-0 hover:bg-muted ${
                isSelected ? "bg-primary/5" : ""
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-foreground">
                  {c.dna.symbol} {c.dna.timeframe} {c.dna.direction.toUpperCase()}
                </span>
                <span
                  className={
                    c.survivor
                      ? "rounded-full border border-positive/40 bg-positive/10 px-1.5 py-0.5 text-xs text-positive"
                      : "rounded-full border border-border px-1.5 py-0.5 text-xs text-muted-foreground"
                  }
                >
                  {c.survivor ? `survivor · grade ${c.grade ?? "—"}` : "rejected"}
                </span>
              </div>

              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3 lg:grid-cols-4">
                <MiniStat label="Score" value={c.score === null ? null : c.score.toFixed(1)} />
                <MiniStat
                  label="Expectancy"
                  value={m ? `${m.expectancyR.toFixed(3)}R` : null}
                />
                <MiniStat label="Win rate" value={m ? `${m.winRate.toFixed(1)}%` : null} />
                <MiniStat
                  label="Drawdown"
                  value={m ? `${m.maxDrawdownPct.toFixed(1)}%` : null}
                />
                <MiniStat
                  label="Profit factor"
                  value={m ? (Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : "∞") : null}
                />
                <MiniStat label="Sample" value={m ? `${m.totalTrades} trades` : null} />
                <MiniStat
                  label="OOS win rate"
                  value={oos ? `${oos.winRate.toFixed(1)}%` : null}
                />
                <MiniStat
                  label="OOS return"
                  value={oos ? `${oos.returnPct.toFixed(2)}%` : null}
                />
              </div>

              {c.dna.mutationNote ? (
                <p className="mt-1 text-xs text-muted-foreground">{c.dna.mutationNote}</p>
              ) : null}
              {!c.survivor && c.rejectionReason ? (
                <p className="mt-1 text-xs text-muted-foreground/90">
                  Rejected: {c.rejectionReason}
                </p>
              ) : null}
              {c.error ? <p className="mt-1 text-xs text-negative">{c.error}</p> : null}
            </button>
          );
        })}
      </div>
    </TerminalPanel>
  );
}

function MiniStat({ label, value }: { label: string; value: string | null }) {
  return (
    <span className="flex items-baseline justify-between gap-1.5 text-xs">
      <span className="truncate text-muted-foreground">{label}</span>
      {value === null ? (
        <span className="text-muted-foreground/70 italic">n/a</span>
      ) : (
        <span className="font-mono tabular-nums text-foreground">{value}</span>
      )}
    </span>
  );
}
