"use client";

import { memo } from "react";
import { Activity } from "lucide-react";
import {
  AwaitingState,
  BiasChip,
  ConfidenceMeter,
  SourcedLoose,
  SourcedValue,
  SourceFooter,
  SourceTag,
  TerminalPanel,
  TerminalRow,
  TerminalTable,
} from "@/components/scalping/TerminalPrimitives";
import { formatPrice, formatSigned } from "@/lib/scalping/client";
import type { RadarResult, RadarRow as RadarRowType } from "@/lib/ai/scalping/radar";

/**
 * Market Radar — one dense row per watched symbol.
 *
 * Memoised per row so a refresh of one symbol's metrics does not re-render the
 * whole table. Every cell routes through a `Sourced*` primitive, so an
 * unavailable metric reads "Data unavailable" rather than showing a zero.
 */

const VOL_TONE: Record<string, string> = {
  low: "text-muted-foreground",
  normal: "text-foreground",
  high: "text-warning",
  extreme: "text-negative",
};

const RadarRow = memo(function RadarRowView({ row }: { row: RadarRowType }) {
  const change = row.changePercent.value;
  return (
    <TerminalRow
      highlight={row.stale === false && row.confidence.status === "available"}
      cells={[
        <span key="sym" className="flex flex-col gap-0.5">
          <span className="font-mono text-xs font-semibold text-foreground">{row.symbol}</span>
          <span className="text-xs text-muted-foreground">
            {row.timeframe}
            {row.stale ? <span className="ml-1 text-warning">· stale</span> : null}
          </span>
        </span>,
        <span key="px" className="font-mono tabular-nums">
          <SourcedValue metric={row.lastPrice} format={(v) => formatPrice(v)} />
        </span>,
        <span
          key="chg"
          className={
            change === null
              ? ""
              : `font-mono tabular-nums ${change >= 0 ? "text-positive" : "text-negative"}`
          }
        >
          <SourcedValue metric={row.changePercent} format={(v) => formatSigned(v, 3)} />
        </span>,
        <span key="trend">
          <BiasChip bias={row.trend.value?.bias} />
        </span>,
        <span key="mom">
          <BiasChip bias={row.momentum.value?.bias} />
        </span>,
        <span key="vol" className={VOL_TONE[row.volatility.value?.state ?? "unavailable"] ?? ""}>
          <SourcedLoose
            metric={row.volatility.value ? { ...row.volatility, value: row.volatility.value.state } : null}
            format={(v) => String(v)}
            fallbackText="Data unavailable"
          />
        </span>,
        <span key="liq" className="font-mono tabular-nums">
          {row.liquidity.value ? row.liquidity.value.levelCount : "—"}
        </span>,
        <span key="regime" className="text-xs text-muted-foreground">
          <SourcedLoose
            metric={
              row.regime.value
                ? { ...row.regime, value: row.regime.value.regime }
                : null
            }
            format={(v) => String(v).replace(/_/g, " ")}
            fallbackText="Data unavailable"
            className="text-xs"
          />
        </span>,
        <span key="conf" className="min-w-[92px]">
          <ConfidenceMeter
            metric={row.confidence}
            label2={
              row.confidence.status === "available" ? (
                <span className="font-mono tabular-nums">{row.confidence.value?.toFixed(0)}</span>
              ) : undefined
            }
          />
        </span>,
      ]}
    />
  );
});

export function MarketRadar({
  radar,
  loading,
  invalid = [],
}: {
  radar: RadarResult | null;
  loading: boolean;
  /** Symbols the request contained that the API rejected as unsupported. */
  invalid?: string[];
}) {
  if (!radar) {
    return (
      <TerminalPanel
        title="Market Radar"
        icon={<Activity className="size-3.5" />}
        dense
        className="min-h-[220px]"
      >
        <AwaitingState
          className="m-3"
          reason={loading ? "Building the radar from live candles…" : "No radar data yet."}
          compact
        />
      </TerminalPanel>
    );
  }

  if (radar.rows.length === 0) {
    return (
      <TerminalPanel
        title="Market Radar"
        icon={<Activity className="size-3.5" />}
        meta={`${radar.failed.length} symbol(s) unavailable`}
        className="min-h-[220px]"
      >
        <AwaitingState reason="The market data provider returned no candles for any watched symbol." />
        {radar.failed.length > 0 ? (
          <div className="mt-3 space-y-1">
            {radar.failed.map((f) => (
              <p key={f.symbol} className="text-xs text-muted-foreground">
                <span className="font-mono">{f.symbol}</span> — {f.reason}
              </p>
            ))}
          </div>
        ) : null}
      </TerminalPanel>
    );
  }

  return (
    <TerminalPanel
      title="Market Radar"
      icon={<Activity className="size-3.5" />}
      meta={
        `${radar.rows.length} symbol${radar.rows.length === 1 ? "" : "s"} · ${radar.timeframe}` +
        (invalid.length > 0 ? ` · ${invalid.length} unsupported` : "")
      }
      dense
      action={<SourceTag source={radar.dataSource} />}
    >
      <TerminalTable
        head={[
          "Symbol",
          "Last",
          "Chg%",
          "Trend",
          "Momentum",
          "Volatility",
          "Liq",
          "Regime",
          "AI confidence",
        ]}
      >
        {radar.rows.map((row) => (
          <RadarRow key={row.symbol} row={row} />
        ))}
      </TerminalTable>

      <SourceFooter
        className="border-t border-border px-3 py-2"
        items={[
          { label: "Source", value: <span>{radar.dataSource.label}</span> },
          {
            label: "Confidence basis",
            value: (
              <span>
                market score 50% · regime confidence 30% · VWAP alignment 20%
              </span>
            ),
          },
          ...(radar.failed.length > 0
            ? [
                {
                  label: "Unavailable",
                  value: <span className="text-warning">{radar.failed.map((f) => f.symbol).join(", ")}</span>,
                },
              ]
            : []),
          ...(invalid.length > 0
            ? [
                {
                  label: "Rejected",
                  value: (
                    <span className="text-muted-foreground">{invalid.join(", ")} — not in the supported symbol list</span>
                  ),
                },
              ]
            : []),
        ]}
      />

      {/* Per-symbol degradation reasons, so "unavailable" is always explainable. */}
      {radar.rows.some((r) => r.degraded.length > 0) ? (
        <div className="border-t border-border px-3 py-2">
          {radar.rows
            .filter((r) => r.degraded.length > 0)
            .map((r) => (
              <p key={r.symbol} className="text-xs text-muted-foreground">
                <span className="font-mono">{r.symbol}</span>:{" "}
                {r.degraded.map((d) => `${d.agent} — ${d.reason}`).join("; ")}
              </p>
            ))}
        </div>
      ) : null}
    </TerminalPanel>
  );
}
