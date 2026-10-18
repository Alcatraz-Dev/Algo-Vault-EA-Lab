/**
 * AlgoVault Chrome Extension — Intelligence panel (PHASE 11).
 *
 * Shows three clearly separated evidence groups:
 *   ALGOVAULT    — deterministic engine output (structure, smart money,
 *                  liquidity, FVG, order blocks, MTF, setup state)
 *   TRADINGVIEW  — external context (technicals, news, economic events) with
 *                  freshness labels, only when connected
 *   AI           — evidence summary, interpretation and limitations
 *
 * Plus the TradingView connection status and Connect / Reconnect actions,
 * which hand off to the secure AlgoVault OAuth flow (never tokens here).
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Clock,
  Globe,
  Info,
  Loader2,
  Plug,
  RefreshCw,
  Unplug,
} from "lucide-react";
import type { MarketContext } from "@/types/market-context";
import {
  getTradingViewStatus,
  getTradingViewContext,
  openTradingViewConnectPage,
  type TradingViewStatus,
  type TradingViewContextSection,
} from "@/api/tradingview";

interface TradingViewPanelProps {
  symbol: string | null;
  timeframe: string | null;
  marketContext: MarketContext | null;
  aiSummary: string | null;
  loadingAi: boolean;
  onRefreshContext: () => void;
}

const STATE_BADGE: Record<TradingViewStatus["state"], { label: string; cls: string }> = {
  CONNECTED: { label: "CONNECTED", cls: "bg-positive/10 text-positive" },
  DISCONNECTED: { label: "NOT CONNECTED", cls: "bg-secondary text-muted-foreground" },
  CONNECTING: { label: "CONNECTING…", cls: "bg-secondary text-foreground" },
  TOKEN_EXPIRED: { label: "REAUTH REQUIRED", cls: "bg-warning/10 text-warning" },
  REAUTH_REQUIRED: { label: "REAUTH REQUIRED", cls: "bg-warning/10 text-warning" },
  ERROR: { label: "ERROR", cls: "bg-negative/10 text-negative" },
  DISABLED: { label: "DISABLED", cls: "bg-secondary text-muted-foreground" },
};

function Section({ title, badge, children }: { title: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
        {badge}
      </div>
      {children}
    </div>
  );
}

function TvSectionCard({ icon, title, section }: { icon: React.ReactNode; title: string; section: TradingViewContextSection | undefined }) {
  if (!section) return null;
  return (
    <div className="rounded-lg bg-secondary/60 p-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-[10px] font-medium text-foreground">
          {icon}
          {title}
        </span>
        <span className="text-[10px] uppercase text-muted-foreground">{section.state}</span>
      </div>
      {section.available && section.items[0] ? (
        <>
          <p className="mt-1 line-clamp-3 whitespace-pre-line text-[10px] leading-4 text-muted-foreground">{section.items[0].value}</p>
          <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock size={10} /> {section.items[0].freshnessLabel}
          </p>
        </>
      ) : (
        <p className="mt-1 text-[10px] text-muted-foreground">{section.message || "Not available."}</p>
      )}
    </div>
  );
}

export function TradingViewPanel({ symbol, timeframe, marketContext, aiSummary, loadingAi, onRefreshContext }: TradingViewPanelProps) {
  const [status, setStatus] = useState<TradingViewStatus | null>(null);
  const [tvContext, setTvContext] = useState<{
    technicals: TradingViewContextSection;
    news: TradingViewContextSection;
    economicCalendar: TradingViewContextSection;
    limitations: string[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const capabilities = await getTradingViewStatus();
      setStatus(capabilities.status);
      if (capabilities.status.state === "CONNECTED" && symbol) {
        const ctx = await getTradingViewContext(symbol, timeframe || "H1", "terminal");
        if (ctx?.success) {
          setTvContext({
            technicals: ctx.tradingview.technicals,
            news: ctx.tradingview.news,
            economicCalendar: ctx.tradingview.economicCalendar,
            limitations: ctx.limitations ?? [],
          });
        } else {
          setTvContext(null);
        }
      } else {
        setTvContext(null);
      }
    } catch {
      setStatus(null);
      setTvContext(null);
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe]);

  useEffect(() => {
    void load();
  }, [load]);

  const badge = status ? STATE_BADGE[status.state] : { label: "OFFLINE", cls: "bg-secondary text-muted-foreground" };
  const connected = status?.state === "CONNECTED";
  const needsReconnect = status?.state === "TOKEN_EXPIRED" || status?.state === "REAUTH_REQUIRED";

  return (
    <div className="space-y-2.5">
      {/* ── ALGOVAULT evidence ─────────────────────────────────────────── */}
      <Section
        title="AlgoVault"
        badge={<span className="rounded-full border border-border bg-secondary/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">DETERMINISTIC</span>}
      >
        {marketContext ? (
          <div className="grid grid-cols-2 gap-1 text-[10px]">
            <span className="text-muted-foreground">Structure</span>
            <span className="text-right text-foreground">{marketContext.marketStructure.overall}</span>
            <span className="text-muted-foreground">BOS / CHOCH</span>
            <span className="text-right font-numeric text-foreground">{marketContext.marketStructure.bosCount}/{marketContext.marketStructure.chochCount}</span>
            <span className="text-muted-foreground">Liquidity</span>
            <span className="text-right text-foreground">{marketContext.liquidity.levels.length} levels</span>
            <span className="text-muted-foreground">FVG</span>
            <span className="text-right text-foreground">{marketContext.fvg.count} ({marketContext.fvg.direction})</span>
            <span className="text-muted-foreground">Order Blocks</span>
            <span className="text-right text-foreground">{marketContext.orderBlock.count} ({marketContext.orderBlock.direction})</span>
            <span className="text-muted-foreground">MTF bias</span>
            <span className="text-right text-foreground">{marketContext.mtfAlignment.map((m) => m.bias[0].toUpperCase()).join("") || "—"}</span>
            <span className="text-muted-foreground">Score</span>
            <span className="text-right font-numeric text-foreground">{marketContext.score.total} ({marketContext.score.bias})</span>
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground">Awaiting engine data for {symbol ?? "chart"}…</p>
        )}
      </Section>

      {/* ── TRADINGVIEW evidence ───────────────────────────────────────── */}
      <Section
        title="TradingView"
        badge={<span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>{badge.label}</span>}
      >
        {loading ? (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Loader2 size={10} className="animate-spin" /> Checking connection…
          </div>
        ) : connected && tvContext ? (
          <div className="space-y-1.5">
            <TvSectionCard icon={<Globe size={10} />} title="Technicals" section={tvContext.technicals} />
            <TvSectionCard icon={<Info size={10} />} title="News" section={tvContext.news} />
            <TvSectionCard icon={<Clock size={10} />} title="Economic events" section={tvContext.economicCalendar} />
            <p className="text-[10px] leading-4 text-muted-foreground">
              May be delayed — context only, never execution.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <p className="text-[10px] text-muted-foreground">
              {status?.message || "TradingView external context is not available."}
            </p>
            <button
              type="button"
              onClick={() => void openTradingViewConnectPage()}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-secondary py-1.5 text-[10px] font-medium text-foreground transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
            >
              {needsReconnect ? <RefreshCw size={10} /> : <Plug size={10} />}
              {needsReconnect ? "Reconnect TradingView" : "Connect TradingView"}
            </button>
          </div>
        )}
        {connected ? (
          <button
            type="button"
            onClick={() => void openTradingViewConnectPage()}
            className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-lg text-[10px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Unplug size={10} /> Manage connection in AlgoVault settings
          </button>
        ) : null}
      </Section>

      {/* ── AI summary ─────────────────────────────────────────────────── */}
      <Section title="AI" badge={<span className="rounded-full border border-border bg-secondary/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">EVIDENCE-ONLY</span>}>
        {loadingAi ? (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Loader2 size={10} className="animate-spin" /> Analyzing evidence…
          </div>
        ) : aiSummary ? (
          <p className="whitespace-pre-line text-[10px] leading-4 text-muted-foreground">{aiSummary}</p>
        ) : (
          <p className="text-[10px] text-muted-foreground">Run an analysis to see the evidence summary, interpretation and limitations.</p>
        )}
        {tvContext && tvContext.limitations.length > 0 ? (
          <div className="mt-1.5 border-t border-border pt-1.5">
            <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase text-warning">
              <AlertCircle size={10} /> Limitations
            </p>
            <ul className="list-inside list-disc text-[10px] leading-4 text-muted-foreground">
              {tvContext.limitations.slice(0, 3).map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      <button
        type="button"
        onClick={onRefreshContext}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-secondary py-1.5 text-[10px] font-medium text-foreground transition-colors hover:bg-secondary/80"
      >
        <RefreshCw size={10} /> Refresh evidence
      </button>
    </div>
  );
}

export type { MarketContext };
