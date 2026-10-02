/**
 * AlgoVault live overlay for TradingView.
 *
 * A movable, collapsible panel that auto-updates from the canonical
 * ChartContext (browser detection) and the enriched context (market data),
 * showing symbol·timeframe, price, trend, structure, volatility, setup verdict
 * and quick actions. Position / collapsed / visibility are persisted so the
 * panel stays where the trader left it.
 *
 * Dragging uses Pointer Events on the header handle (works for mouse, touch
 * and pen), clamps the panel fully inside the viewport, and re-clamps on
 * window resize so the panel can never end up stranded off-screen.
 */
import React, { useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  ChevronLeft,
  EyeOff,
  GripVertical,
  Shield,
  X,
  Zap,
} from "lucide-react";
import type { ChartContext, ViewMode } from "@/types";
import type { EnrichedChartContext } from "@/services/chart-intelligence";
import { getOverlayState, setOverlayState, getSettings } from "@/storage/storage";
import { chartDisplayLabel } from "@/services/chart-intelligence";
import { OVERLAY_CLOSED_EVENT } from "@/content/quick-launcher";

/* ── theme ───────────────────────────────────────────────────────────── */

const C = {
  panel: "rgba(16, 16, 18, 0.92)",
  border: "1px solid rgba(255, 77, 0, 0.35)",
  borderSoft: "rgba(255, 255, 255, 0.07)",
  text: "#f5f5f5",
  textDim: "#a3a3a3",
  textFaint: "#6b6b6b",
  accent: "#ff6b26",
  accentSoft: "rgba(255, 77, 0, 0.12)",
  accentBorder: "rgba(255, 77, 0, 0.28)",
  green: "#34d399",
  red: "#fb7185",
  amber: "#fbbf24",
  mono: "'SF Mono', 'Cascadia Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
  sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
} as const;

/* ── actions ─────────────────────────────────────────────────────────── */

interface ActionDef {
  id: string;
  view: ViewMode | "quick-alert";
  label: string;
  Icon: React.ComponentType<{ size?: number | string; color?: string; strokeWidth?: number | string }>;
  accent: string;
}

const ACTIONS: ActionDef[] = [
  { id: "ai", view: "ai-copilot", label: "Copilot", Icon: Bot, accent: "#c084fc" },
  { id: "analyze", view: "analysis", label: "Analyze", Icon: BarChart3, accent: "#60a5fa" },
  { id: "signal", view: "signal", label: "Signal", Icon: Zap, accent: "#fbbf24" },
  { id: "risk", view: "risk", label: "Risk", Icon: Shield, accent: "#34d399" },
  { id: "alert", view: "quick-alert", label: "Alert", Icon: Bell, accent: "#f87171" },
];

/* ── helpers ─────────────────────────────────────────────────────────── */

interface PanelState {
  collapsed: boolean;
  visible: boolean;
  position: { x: number; y: number };
  /** Minimized to the tiny quick-open launcher instead of hidden entirely. */
  closed: boolean;
  /** Persisted launcher position (-1 = resolve to a corner on first render). */
  launcher: { x: number; y: number };
}

function priceString(value: number | null | undefined): string {
  if (value == null) return "—";
  const decimals = value >= 1000 ? 1 : value >= 100 ? 2 : 4;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/* Keep a panel position fully inside the viewport (with an 8px margin). */
function clampPosition(
  position: { x: number; y: number },
  collapsed: boolean
): { x: number; y: number } {
  const w = collapsed ? 160 : PANEL_SIZE.w;
  const h = collapsed ? 34 : PANEL_SIZE.h;
  return {
    x: clamp(position.x, 8, Math.max(8, window.innerWidth - w - 8)),
    y: clamp(position.y, 8, Math.max(8, window.innerHeight - h - 8)),
  };
}

/* Measured panel size is kept in a ref so dragging can clamp correctly. */
const PANEL_SIZE = { w: 268, h: 320 };

/* ── small presentational pieces ─────────────────────────────────────── */

function TrendChip({ direction }: { direction: string }): React.ReactElement {
  const color =
    direction === "bullish" || direction === "long"
      ? C.green
      : direction === "bearish" || direction === "short"
      ? C.red
      : C.textDim;
  return (
    <span
      style={{
        padding: "1px 6px",
        borderRadius: 4,
        background: `${color}1f`,
        color,
        fontSize: 9,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        lineHeight: "14px",
        whiteSpace: "nowrap",
      }}
    >
      {direction}
    </span>
  );
}

function ActionButton({
  label,
  Icon,
  accent,
  onClick,
}: {
  label: string;
  Icon: ActionDef["Icon"];
  accent: string;
  onClick: () => void;
}): React.ReactElement {
  const [hover, setHover] = useState(false);
  return (
    <button
      data-overlay-action
      onClick={onClick}
      title={label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        padding: "6px 0 5px",
        borderRadius: 8,
        background: hover ? `${accent}26` : C.accentSoft,
        border: `1px solid ${hover ? `${accent}66` : C.accentBorder}`,
        color: hover ? accent : "#ffe6db",
        cursor: "pointer",
        transition: "background 0.15s ease, border-color 0.15s ease, color 0.15s ease",
        fontFamily: C.sans,
      }}
    >
      <Icon size={13} strokeWidth={2} />
      <span style={{ fontSize: 8.5, fontWeight: 600, letterSpacing: "0.02em", whiteSpace: "nowrap" }}>
        {label}
      </span>
    </button>
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
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      <span
        style={{
          flex: "0 0 auto",
          width: 62,
          fontSize: 9,
          color: C.textDim,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 10,
          fontWeight: 500,
          color: valueColor ?? C.text,
          textTransform: "capitalize",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: C.mono,
        }}
      >
        {value}
      </span>
    </div>
  );
}

/* ── main overlay ────────────────────────────────────────────────────── */

function AlgoVaultOverlay() {
  const [state, setState] = useState<PanelState>({
    collapsed: false,
    visible: true,
    position: { x: 24, y: 140 },
    closed: false,
    launcher: { x: -1, y: -1 },
  });
  const [chart, setChart] = useState<ChartContext | null>(null);
  const [intel, setIntel] = useState<EnrichedChartContext | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const pointerId = useRef<number | null>(null);
  const dragMoved = useRef(false);
  const closedRef = useRef(false);

  /* load persisted state + respect the showOverlay setting */
  useEffect(() => {
    Promise.all([getOverlayState(), getSettings()])
      .then(([s, settings]) => {
        setState((prev) => ({
          ...prev,
          collapsed: s.collapsed,
          visible: s.visible && settings.showOverlay !== false,
          position: s.position,
          closed: s.closed ?? false,
          launcher: s.launcher ?? { x: -1, y: -1 },
        }));
        setHydrated(true);
      })
      .catch(() => setHydrated(true));
  }, []);

  /* the small quick-launcher asks the full panel to come back */
  useEffect(() => {
    const onReopen = () => {
      setState((prev) => (prev.closed || !prev.visible ? { ...prev, closed: false, visible: true } : prev));
    };
    window.addEventListener(OVERLAY_CLOSED_EVENT, onReopen);
    return () => window.removeEventListener(OVERLAY_CLOSED_EVENT, onReopen);
  }, []);

  /* the mini launcher also lives across full-panel visibility changes */
  useEffect(() => {
    const prevClosed = closedRef.current;
    closedRef.current = state.closed;
    if (state.closed === prevClosed) return;
    if (hydrated) setOverlayState({ closed: state.closed }).catch(() => {});
  }, [state.closed, hydrated]);

  /* live-reaction to the settings toggle (options / popup) */
  useEffect(() => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes.settings) {
        const next = changes.settings.newValue as { showOverlay?: boolean } | undefined;
        setState((prev) => ({
          ...prev,
          visible: next?.showOverlay !== false && prev.visible,
        }));
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  /* persistence — debounced so a drag doesn't hammer chrome.storage, and
     only after hydration so we don't clobber stored defaults */
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      setOverlayState(state).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [state, hydrated]);

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

  /* keep the panel inside the viewport when the window resizes or when it
     expands from the collapsed pill (the full panel is much taller) */
  useEffect(() => {
    const reclamp = () => {
      setState((prev) => {
        const next = clampPosition(prev.position, prev.collapsed);
        if (next.x === prev.position.x && next.y === prev.position.y) return prev;
        return { ...prev, position: next };
      });
    };
    reclamp();
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
  }, []);

  useEffect(() => {
    setState((prev) => {
      const next = clampPosition(prev.position, prev.collapsed);
      if (next.x === prev.position.x && next.y === prev.position.y) return prev;
      return { ...prev, position: next };
    });
  }, [state.collapsed]);

  /* ── drag: pointer events on the header handle ─────────────────────── */

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("[data-overlay-action]")) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;

      const rect = panelRef.current?.getBoundingClientRect();
      const origin = rect ?? { left: state.position.x, top: state.position.y };
      dragOffset.current = { x: e.clientX - origin.left, y: e.clientY - origin.top };
      pointerId.current = e.pointerId;
      dragMoved.current = false;
      setIsDragging(true);
      e.preventDefault();

      /* Attach the move/up listeners immediately (not in an effect) so the
         very first pointermove is never lost, and pass the live panel size
         so the clamp bounds are correct from tick one. */
      const w = panelRef.current?.offsetWidth ?? PANEL_SIZE.w;
      const h = panelRef.current?.offsetHeight ?? PANEL_SIZE.h;

      const onMove = (ev: PointerEvent) => {
        if (pointerId.current != null && ev.pointerId !== pointerId.current) return;
        dragMoved.current = true;
        const x = clamp(ev.clientX - dragOffset.current.x, 4, Math.max(4, window.innerWidth - w - 4));
        const y = clamp(ev.clientY - dragOffset.current.y, 4, Math.max(4, window.innerHeight - h - 4));
        setState((prev) => ({ ...prev, position: { x, y } }));
      };

      const onUp = (ev: PointerEvent) => {
        if (pointerId.current != null && ev.pointerId !== pointerId.current) return;
        setIsDragging(false);
        pointerId.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };

      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [state.position.x, state.position.y]
  );

  /**
   * Overlay buttons open tabs INSIDE the extension. They can't open the popup
   * directly (chrome.action.openPopup() is gesture-gated and silently blocked
   * from content scripts), so they ask the service worker to park + broadcast
   * the view; the popup (or side panel) navigates when alive.
   */
  const handleAction = (view: string) => {
    if (view === "quick-alert") {
      // One-tap alert at the current price + jump to the signals tab where it
      // appears. The SW creates the alert and broadcasts the result.
      const price = intel?.market?.currentPrice ?? chart?.price;
      const symbol = chart?.symbol;
      if (symbol && price != null) {
        chrome.runtime.sendMessage({
          type: "AUTO_CREATE_ALERT",
          payload: { symbol, price, timeframe: chart?.timeframe || "H1" },
        });
      } else {
        // No live price yet — still open the extension so the user can pick.
        chrome.runtime.sendMessage({ type: "OPEN_EXTENSION_VIEW", view: "signals-list" });
      }
      return;
    }
    if (view === "ai-copilot") {
      // Open the Copilot TAB inside the extension (popup), not the side panel.
      chrome.runtime.sendMessage({ type: "OPEN_EXTENSION_VIEW", view: "ai-copilot" });
      return;
    }
    const legacyMap: Record<string, string> = {
      analysis: "ANALYZE_CHART",
      signal: "CREATE_SIGNAL",
      "strategy-intelligence": "OPEN_STRATEGY_LAB",
      risk: "CALCULATE_RISK",
    };
    chrome.runtime.sendMessage({ type: legacyMap[view] ?? "ANALYZE_CHART", payload: chart });
  };

  /** Persist the closed flag and, when re-opening, the last panel visibility. */
  const setClosed = (closed: boolean) => {
    setState((prev) => ({ ...prev, closed, visible: closed ? prev.visible : true }));
  };

  /* While minimized, the standalone quick-launcher content script renders the
     draggable reopen orb (it survives TradingView's SPA navigations); the
     overlay itself renders nothing. */
  if (!state.visible && !state.closed) return null;

  if (state.closed) return null;

  const setup = intel?.setup;
  const market = intel?.market;
  const displayPrice = intel?.market?.currentPrice ?? chart?.price;
  const priceDeviation = intel?.priceValidation;
  const live = market?.status === "ready";

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
        <div
          ref={panelRef}
          onPointerDown={startDrag}
          onClick={() => {
            if (dragMoved.current) return; // ignore clicks that finish a drag
            setState((prev) => ({ ...prev, collapsed: false }));
          }}
          title={`${chartDisplayLabel(chart)} — expand AlgoVault overlay`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            borderRadius: 10,
            background: C.panel,
            border: C.border,
            cursor: "grab",
            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.45)",
            color: C.text,
            fontSize: 11,
            fontFamily: C.mono,
            backdropFilter: "blur(12px)",
            transition: "border-color 0.15s ease, box-shadow 0.15s ease",
            touchAction: "none",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "rgba(255, 77, 0, 0.6)";
            e.currentTarget.style.boxShadow = "0 4px 20px rgba(255, 77, 0, 0.18)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "rgba(255, 77, 0, 0.35)";
            e.currentTarget.style.boxShadow = "0 4px 16px rgba(0, 0, 0, 0.45)";
          }}
        >
          <Zap size={12} color={C.accent} fill={C.accent} />
          <span style={{ fontWeight: 600 }}>{chartDisplayLabel(chart)}</span>
        </div>
      </div>
    );
  }

  /* ── full panel ──────────────────────────────────────────────────── */
  return (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        left: state.position.x,
        top: state.position.y,
        zIndex: 2147483647,
        width: PANEL_SIZE.w,
        maxWidth: "calc(100vw - 16px)",
        fontFamily: C.sans,
        fontSize: 12,
        userSelect: "none",
        color: C.text,
        background: C.panel,
        border: C.border,
        borderRadius: 12,
        boxShadow: isDragging
          ? "0 18px 48px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 77, 0, 0.25)"
          : "0 10px 40px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 77, 0, 0.08)",
        backdropFilter: "blur(14px)",
        overflow: "hidden",
        transition: isDragging ? "none" : "box-shadow 0.2s ease",
      }}
    >
      {/* header (drag handle) */}
      <div
        onPointerDown={startDrag}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 8px 8px 10px",
          borderBottom: `1px solid ${C.borderSoft}`,
          cursor: isDragging ? "grabbing" : "grab",
          touchAction: "none",
          background: isDragging ? "rgba(255, 77, 0, 0.06)" : "transparent",
        }}
      >
        <GripVertical size={12} color={isDragging ? C.accent : C.textFaint} />
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            fontFamily: C.mono,
            color: C.accent,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {chartDisplayLabel(chart)}
        </span>
        <span
          style={{
            marginLeft: "auto",
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            gap: 2,
          }}
        >
          <IconButton
            title="Collapse"
            onClick={() => setState((prev) => ({ ...prev, collapsed: true }))}
          >
            <ChevronLeft size={12} />
          </IconButton>
          <IconButton
            title="Hide overlay"
            onClick={() => setState((prev) => ({ ...prev, visible: false }))}
          >
            <EyeOff size={12} />
          </IconButton>
          <IconButton
            title="Minimize to launcher"
            onClick={() => setClosed(true)}
          >
            <X size={12} />
          </IconButton>
        </span>
      </div>

      {/* price row */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "8px 10px 4px" }}>
        <span
          style={{
            fontSize: 16,
            fontWeight: 700,
            fontFamily: C.mono,
            letterSpacing: "-0.01em",
          }}
        >
          {priceString(displayPrice)}
        </span>
        {setup && <TrendChip direction={setup.direction} />}
        {live ? (
          <span
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 9,
              fontWeight: 600,
              color: C.green,
              letterSpacing: "0.06em",
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: C.green,
                boxShadow: "0 0 6px rgba(52, 211, 153, 0.9)",
                animation: "algovaultPulse 1.6s ease-in-out infinite",
              }}
            />
            LIVE
          </span>
        ) : (
          <span
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 9,
              color: C.textDim,
              letterSpacing: "0.06em",
            }}
          >
            <Activity size={9} />
            SYNC
          </span>
        )}
      </div>

      {/* price validation hint */}
      {priceDeviation && priceDeviation.deviationPct != null && !priceDeviation.matched && (
        <div style={{ padding: "0 10px" }}>
          <span style={{ fontSize: 9, color: C.amber }}>
            Price deviates {Math.abs(priceDeviation.deviationPct).toFixed(2)}% from market data
          </span>
        </div>
      )}

      {/* setup confidence meter */}
      {setup && setup.direction !== "neutral" && (
        <div style={{ padding: "2px 10px 4px" }}>
          <div
            style={{
              position: "relative",
              height: 3,
              borderRadius: 3,
              background: "rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: setup.direction === "long" ? "50%" : undefined,
                right: setup.direction === "short" ? "50%" : undefined,
                width: `${clamp(Math.abs(setup.score), 0, 100) / 2}%`,
                borderRadius: 3,
                background: setup.direction === "long" ? C.green : C.red,
                transition: "width 0.5s ease",
              }}
            />
          </div>
        </div>
      )}

      {/* stats */}
      <div
        style={{
          padding: "6px 10px 2px",
          display: "flex",
          flexDirection: "column",
          gap: 3,
          minHeight: 0,
        }}
      >
        {market?.status === "ready" && (
          <>
            <StatRow
              label="Trend"
              value={market.trend.direction}
              valueColor={
                market.trend.direction === "bullish"
                  ? C.green
                  : market.trend.direction === "bearish"
                  ? C.red
                  : C.textDim
              }
            />
            <StatRow
              label="Structure"
              value={`${market.marketStructure.overall} (${market.marketStructure.bosCount}B/${market.marketStructure.chochCount}C)`}
            />
            <StatRow
              label="Volatility"
              value={`${market.volatility.state} · ATR ${priceString(market.volatility.atr)}`}
            />
            <StatRow label="Regime" value={market.marketRegime.regime.replace(/_/g, " ")} />
            <StatRow label="Score" value={`${market.score.total}/100 ${market.score.bias}`} />
          </>
        )}
        {setup && setup.reasons.length > 0 && (
          <StatRow
            label="Setup"
            value={setup.label}
            valueColor={
              setup.direction === "long"
                ? C.green
                : setup.direction === "short"
                ? C.red
                : C.textDim
            }
          />
        )}
        {!market && (
          <StatRow
            label="Status"
            value={
              chart?.marketSync === "unsupported"
                ? `Unsupported (${chart.unsupportedReason ?? "symbol"})`
                : "Waiting for market data…"
            }
          />
        )}
      </div>

      {/* actions */}
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: "8px 10px 10px",
          borderTop: `1px solid ${C.borderSoft}`,
          marginTop: 6,
        }}
      >
        {ACTIONS.map((a) => (
          <ActionButton
            key={a.id}
            label={a.label}
            Icon={a.Icon}
            accent={a.accent}
            onClick={() => handleAction(a.view)}
          />
        ))}
      </div>

      {/* keyframes for the LIVE pulse */}
      <style>{`@keyframes algovaultPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }`}</style>
    </div>
  );
}

/* ── header icon button ──────────────────────────────────────────────── */

function IconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  const [hover, setHover] = useState(false);
  return (
    <button
      data-overlay-action
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: 6,
        background: hover ? "rgba(255,255,255,0.09)" : "transparent",
        border: "none",
        color: hover ? C.text : C.textDim,
        cursor: "pointer",
        padding: 0,
        transition: "background 0.15s ease, color 0.15s ease",
      }}
    >
      {children}
    </button>
  );
}

/* ── boot ────────────────────────────────────────────────────────────── */

function createShadowContainer(): HTMLDivElement {
  const host = document.createElement("div");
  host.id = "algovault-overlay-host";
  host.style.cssText = "position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;";

  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :host { all: initial; }
    button { font: inherit; }
  `;

  const container = document.createElement("div");
  container.style.cssText = "position: fixed; top: 0; left: 0; width: 0; height: 0; overflow: visible;";

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
