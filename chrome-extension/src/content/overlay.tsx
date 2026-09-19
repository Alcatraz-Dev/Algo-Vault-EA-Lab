/**
 * AlgoVault live overlay for TradingView.
 *
 * A movable, collapsible panel that auto-updates from the canonical
 * ChartContext (browser detection) and the enriched context (market data),
 * showing symbol·timeframe, price, trend, structure, volatility, setup verdict
 * and quick actions. Position / collapsed / visibility are persisted so the
 * panel stays where the trader left it.
 */
import React, { useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { ChevronLeft, ChevronRight, X, GripVertical } from "lucide-react";
import type { ChartContext, TradingViewContext, ViewMode } from "@/types";
import type { EnrichedChartContext } from "@/services/chart-intelligence";
import { getOverlayState, setOverlayState } from "@/storage/storage";
import { chartDisplayLabel } from "@/services/chart-intelligence";

const ACTIONS: Array<{ id: string; view: ViewMode; label: string; icon: string }> = [
  { id: "analyze", view: "analysis", label: "Analyze", icon: "📊" },
  { id: "signal", view: "signal", label: "Signal", icon: "⚡" },
  { id: "strategy", view: "strategy-intelligence", label: "Strategy", icon: "🧠" },
  { id: "risk", view: "risk", label: "Risk", icon: "🛡️" },
  { id: "ai", view: "ai-copilot", label: "AI", icon: "🤖" },
];

interface OverlayState {
  collapsed: boolean;
  visible: boolean;
  position: { x: number; y: number };
}

function priceString(value: number | null | undefined): string {
  if (value == null) return "—";
  const decimals = value >= 1000 ? 1 : value >= 100 ? 2 : 4;
  return value.toFixed(decimals);
}

function TrendChip({ direction }: { direction: string }): React.ReactElement {
  const color =
    direction === "bullish" ? "#34d399" : direction === "bearish" ? "#fb7185" : "#8b8baa";
  return (
    <span
      style={{
        padding: "1px 6px",
        borderRadius: "4px",
        background: `${color}1a`,
        color,
        fontSize: "10px",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
      }}
    >
      {direction}
    </span>
  );
}

function AlgoVaultOverlay() {
  const [state, setState] = useState<OverlayState>({
    collapsed: false,
    visible: true,
    position: { x: 24, y: 140 },
  });
  const [chart, setChart] = useState<ChartContext | null>(null);
  const [intel, setIntel] = useState<EnrichedChartContext | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  /* load persisted state */
  useEffect(() => {
    getOverlayState().then((s) => {
      setState((prev) => ({
        ...prev,
        collapsed: s.collapsed,
        visible: s.visible,
        position: s.position,
      }));
    });
  }, []);

  /* persistence */
  useEffect(() => {
    setOverlayState(state).catch(() => {});
  }, [state]);

  /* live messages */
  useEffect(() => {
    const listener = (message: { type: string; payload?: Record<string, unknown> }) => {
      if (message.type === "TRADINGVIEW_CONTEXT_UPDATE" && message.payload) {
        setChart(message.payload as unknown as ChartContext);
      }
      if (message.type === "MARKET_CONTEXT_READY" && message.payload) {
        setIntel(message.payload as unknown as EnrichedChartContext);
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    // Pull the freshest contexts on mount.
    chrome.runtime.sendMessage({ type: "GET_CONTEXT" }, (resp) => {
      if (resp?.context) setChart(resp.context as ChartContext);
    });
    chrome.runtime.sendMessage({ type: "GET_AI_READY_CONTEXT" }, (resp) => {
      if (resp?.enriched) setIntel(resp.enriched as EnrichedChartContext);
    });

    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  /* drag */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-overlay-action]")) return;
      setIsDragging(true);
      dragOffset.current = {
        x: e.clientX - state.position.x,
        y: e.clientY - state.position.y,
      };
      e.preventDefault();
    },
    [state.position]
  );

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      setState((prev) => ({
        ...prev,
        position: {
          x: Math.max(0, Math.min(window.innerWidth - 40, e.clientX - dragOffset.current.x)),
          y: Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragOffset.current.y)),
        },
      }));
    };
    const handleMouseUp = () => setIsDragging(false);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  const handleAction = (view: ViewMode) => {
    const legacyMap: Record<string, string> = {
      analysis: "ANALYZE_CHART",
      signal: "CREATE_SIGNAL",
      "strategy-intelligence": "OPEN_STRATEGY_LAB",
      risk: "CALCULATE_RISK",
      "ai-copilot": "OPEN_AI_COPILOT",
    };
    chrome.runtime.sendMessage({ type: legacyMap[view] ?? "ANALYZE_CHART", payload: chart });
    setMenuOpen(false);
  };

  if (!state.visible) return null;

  const setup = intel?.setup;
  const market = intel?.market;
  const displayPrice = intel?.market?.currentPrice ?? chart?.price;
  const priceDeviation = intel?.priceValidation;

  /* ── collapsed pill ──────────────────────────────────────────────── */
  if (state.collapsed) {
    return (
      <div
        style={{
          position: "fixed",
          left: state.position.x,
          top: state.position.y,
          zIndex: 2147483647,
        }}
      >
        <button
          data-overlay-action
          onMouseDown={handleMouseDown}
          onClick={() => setState((prev) => ({ ...prev, collapsed: false }))}
          title={`${chartDisplayLabel(chart)} — expand AlgoVault overlay`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "6px 10px",
            borderRadius: "10px",
            background: "rgba(10, 10, 15, 0.92)",
            border: "1px solid rgba(139, 92, 246, 0.45)",
            cursor: "grab",
            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
            color: "#f0f0f5",
            fontSize: "11px",
            fontFamily: "monospace",
          }}
        >
          ⚡ {chartDisplayLabel(chart)}
        </button>
      </div>
    );
  }

  /* ── full panel ──────────────────────────────────────────────────── */
  return (
    <div
      style={{
        position: "fixed",
        left: state.position.x,
        top: state.position.y,
        zIndex: 2147483647,
        width: 248,
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: 12,
        userSelect: "none",
        color: "#f0f0f5",
        background: "rgba(10, 10, 15, 0.94)",
        border: "1px solid rgba(139, 92, 246, 0.35)",
        borderRadius: 12,
        boxShadow: "0 10px 40px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(139, 92, 246, 0.08)",
        backdropFilter: "blur(14px)",
        overflow: "hidden",
      }}
    >
      {/* header (drag handle) */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 10px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          cursor: isDragging ? "grabbing" : "grab",
        }}
      >
        <GripVertical size={12} color="#8b8baa" />
        <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "monospace", color: "#c4b5fd" }}>
          {chartDisplayLabel(chart)}
        </span>
        <span
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 2,
            color: "#8b8baa",
          }}
        >
          <button
            data-overlay-action
            onClick={() => setState((prev) => ({ ...prev, collapsed: true }))}
            title="Collapse"
            style={smallBtn}
          >
            <ChevronLeft size={12} />
          </button>
          <button
            data-overlay-action
            onClick={() => setState((prev) => ({ ...prev, visible: false }))}
            title="Hide overlay"
            style={smallBtn}
          >
            <X size={12} />
          </button>
        </span>
      </div>

      {/* price row */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "8px 10px 4px" }}>
        <span style={{ fontSize: 16, fontWeight: 700, fontFamily: "monospace" }}>
          {priceString(displayPrice)}
        </span>
        {setup && <TrendChip direction={setup.direction} />}
        {market?.status === "ready" ? (
          <span style={{ marginLeft: "auto", fontSize: 9, color: "#34d399" }}>● LIVE</span>
        ) : (
          <span style={{ marginLeft: "auto", fontSize: 9, color: "#8b8baa" }}>SYNC</span>
        )}
      </div>

      {/* price validation hint */}
      {priceDeviation && priceDeviation.deviationPct != null && !priceDeviation.matched && (
        <div style={{ padding: "0 10px" }}>
          <span style={{ fontSize: 9, color: "#fbbf24" }}>
            Price deviates {Math.abs(priceDeviation.deviationPct).toFixed(2)}% from market data
          </span>
        </div>
      )}

      {/* stats */}
      <div style={{ padding: "6px 10px 2px", display: "flex", flexDirection: "column", gap: 3 }}>
        {market?.status === "ready" && (
          <>
            <StatRow label="Trend" value={market.trend.direction} valueColor={
              market.trend.direction === "bullish" ? "#34d399" : market.trend.direction === "bearish" ? "#fb7185" : "#8b8baa"
            } />
            <StatRow label="Structure" value={`${market.marketStructure.overall} (${market.marketStructure.bosCount}B/${market.marketStructure.chochCount}C)`} />
            <StatRow label="Volatility" value={`${market.volatility.state} · ATR ${priceString(market.volatility.atr)}`} />
            <StatRow label="Regime" value={market.marketRegime.regime.replace(/_/g, " ")} />
            <StatRow label="Score" value={`${market.score.total}/100 ${market.score.bias}`} />
          </>
        )}
        {setup && setup.reasons.length > 0 && (
          <StatRow label="Setup" value={setup.label} valueColor={
            setup.direction === "long" ? "#34d399" : setup.direction === "short" ? "#fb7185" : "#8b8baa"
          } />
        )}
        {!market && (
          <StatRow label="Status" value={chart?.marketSync === "unsupported"
            ? `Unsupported (${chart.unsupportedReason ?? "symbol"})`
            : "Waiting for market data…"} />
        )}
      </div>

      {/* actions */}
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: "8px 10px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          marginTop: 6,
        }}
      >
        {ACTIONS.map((a) => (
          <button
            key={a.id}
            data-overlay-action
            onClick={() => handleAction(a.view)}
            title={a.label}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              padding: "5px 0",
              borderRadius: 7,
              background: "rgba(139, 92, 246, 0.12)",
              border: "1px solid rgba(139, 92, 246, 0.25)",
              color: "#e9e4ff",
              cursor: "pointer",
              fontSize: 10,
            }}
          >
            <span style={{ fontSize: 11 }}>{a.icon}</span>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}): React.ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 9, color: "#8b8baa", textTransform: "uppercase", letterSpacing: "0.04em", width: 62 }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 500,
          color: valueColor ?? "#f0f0f5",
          textTransform: "capitalize",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
}

const smallBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 20,
  height: 20,
  borderRadius: 5,
  background: "transparent",
  border: "none",
  color: "#8b8baa",
  cursor: "pointer",
  padding: 0,
};

/* ── boot ────────────────────────────────────────────────────────────── */

function createShadowContainer(): HTMLDivElement {
  const host = document.createElement("div");
  host.id = "algovault-overlay-host";
  host.style.cssText = "position: fixed; top: 0; left: 0; z-index: 2147483647; pointer-events: none;";

  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :host { all: initial; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  `;

  const container = document.createElement("div");
  container.style.cssText = "pointer-events: auto; position: fixed; inset: 0; z-index: 2147483647;";

  shadow.appendChild(style);
  shadow.appendChild(container);
  document.documentElement.appendChild(host);

  return container;
}

function isTradingViewPage(): boolean {
  return window.location.hostname.includes("tradingview.com");
}

function initOverlay(): void {
  if (!isTradingViewPage()) return;
  if (document.getElementById("algovault-overlay-host")) return;

  const container = createShadowContainer();
  const root = createRoot(container);
  root.render(<AlgoVaultOverlay />);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initOverlay);
} else {
  initOverlay();
}