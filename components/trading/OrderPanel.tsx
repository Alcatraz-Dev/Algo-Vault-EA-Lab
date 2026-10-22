"use client";

/**
 * Pro Terminal order ticket — Unified Trading API edition.
 *
 * Every submission goes to `POST /api/trading/execute` → UnifiedTradingService.
 * The panel renders the SERVER's execution states verbatim:
 *
 *   Submitting… → Submitted → Filled
 *                            → Executed — syncing position
 *                            → Rejected (reason)
 *                            → Failed (reason)
 *
 * There is no `setTimeout`, no optimistic "Filled", and no fabricated price:
 * the ticket, execution price and volume shown are the values the server
 * verified at the provider. Idempotency: one `clientRequestId` is minted per
 * logical order and the submit button is disabled while that request is in
 * flight, so double clicks and network retries cannot place two trades.
 */

import { useMemo, useRef, useState } from "react";
import { auth } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  Zap,
  Shield,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TradingAccount } from "./AccountHeader";
import {
  executeUnified,
  newClientRequestId,
  friendlyMessage,
  PHASE_LABEL,
  PHASE_TONE,
  phaseFromStatus,
  UnifiedExecutionError,
  isUnknownOutcome,
  type ClientDisplayPhase,
  type UnifiedExecutePayload,
} from "@/lib/trading/unified/client";
import type {
  TradingExecutionResult,
  TradingExecutionType,
} from "@/lib/trading/unified/domain";

type OrderType = "market" | "limit" | "stop";
type OrderSide = "BUY" | "SELL";

/** The terminal-visible state of the last submission attempt. */
interface TicketState {
  phase: ClientDisplayPhase;
  clientRequestId: string | null;
  result: TradingExecutionResult | null;
  error: string | null;
  /** The idempotency key that produced a terminal outcome — never resubmitted. */
}

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return "—";
  // Broker-agnostic precision: show what the provider actually reported.
  return value < 10 ? value.toFixed(5) : value.toFixed(2);
}

function formatTime(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false });
}

export default function OrderPanel({
  account,
  onOrderPlaced,
  symbol: initialSymbol,
}: {
  account: TradingAccount | null;
  onOrderPlaced: (clientOrderId: string) => void;
  symbol?: string;
}) {
  const [symbol, setSymbol] = useState(
    initialSymbol ? initialSymbol.replace(/^(FX|CRYPTO|INDICES|FOREX):/, "") : "XAUUSD"
  );
  const [lastInitialSymbol, setLastInitialSymbol] = useState(initialSymbol);

  // Prop-sync without an effect: when the chart changes the symbol we adjust
  // state during render (React's documented pattern) instead of setState-in-
  // effect, which would cascade an extra render.
  if (initialSymbol !== lastInitialSymbol) {
    setLastInitialSymbol(initialSymbol);
    if (initialSymbol) {
      setSymbol(initialSymbol.replace(/^(FX|CRYPTO|INDICES|FOREX):/, ""));
    }
  }
  const [side, setSide] = useState<OrderSide>("BUY");
  const [volume, setVolume] = useState("0.01");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [price, setPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [ticket, setTicket] = useState<TicketState | null>(null);
  const [error, setError] = useState("");

  /** In-flight marker state drives the disabled button; the ref is the
   *  synchronous double-click guard inside the submit handler. */
  const [inFlight, setInFlight] = useState(false);
  const inFlightKey = useRef<string | null>(null);
  /** The exact payload of an UNKNOWN submission: replayed under the same key, never re-sent fresh. */
  const unresolvedPayload = useRef<UnifiedExecutePayload | null>(null);

  const parsedVolume = parseFloat(volume) || 0;
  const parsedSL = parseFloat(stopLoss) || 0;
  const parsedTP = parseFloat(takeProfit) || 0;
  const parsedPrice = parseFloat(price) || 0;

  const estimatedRisk =
    parsedSL > 0 && parsedVolume > 0
      ? Math.abs(parsedPrice > 0 ? parsedPrice - parsedSL : 0) * parsedVolume * 100
      : 0;

  const estimatedMargin =
    parsedVolume > 0 && account
      ? parsedVolume * (parsedPrice || account.balance || 0) /
        (parseFloat(account.leverage || "100") || 100)
      : 0;

  const processing = ticket !== null && PHASE_TONE[ticket.phase] === "progress";
  // An UNRESOLVED ticket blocks new submissions until the user confirms in MT5:
  // a timeout may already have filled, and a fresh clientRequestId would duplicate it.
  const unresolved = ticket?.phase === "UNRESOLVED";
  const canSubmit =
    account?.status === "connected" &&
    parsedVolume >= 0.01 &&
    !processing &&
    !unresolved &&
    !inFlight;

  /**
   * Replays the SAME request under its SAME key. The server reconciles it
   * against MT5 history and never re-executes a stored UNKNOWN. The panel
   * unlocks only when the server returns a settled outcome.
   */
  async function handleReconcile() {
    const payload = unresolvedPayload.current;
    const user = auth.currentUser;
    if (!payload || !user || inFlightKey.current !== null) return;
    inFlightKey.current = payload.clientRequestId;
    setInFlight(true);
    setError("");
    try {
      const token = await user.getIdToken();
      const result = await executeUnified(payload, token);
      unresolvedPayload.current = null;
      setTicket({ phase: phaseFromStatus(result.status), clientRequestId: payload.clientRequestId, result, error: null });
      onOrderPlaced(result.clientRequestId);
    } catch (err) {
      if (isUnknownOutcome(err)) {
        setError("Still unresolved — the outcome is not confirmed yet. Try again shortly.");
      } else {
        // A server-settled rejection/failure is an outcome: unlock with it.
        unresolvedPayload.current = null;
        const settled = err instanceof UnifiedExecutionError ? err.result : null;
        setTicket((prev) =>
          prev
            ? {
                ...prev,
                phase: settled ? phaseFromStatus(settled.status) : "FAILED",
                result: settled ?? prev.result,
                error: err instanceof Error ? err.message : null,
              }
            : prev
        );
      }
    } finally {
      inFlightKey.current = null;
      setInFlight(false);
    }
  }

  async function handleSubmit() {
    if (!canSubmit || !account) return;
    if (inFlightKey.current !== null) return; // synchronous double-click guard
    setError("");

    const clientRequestId = newClientRequestId("pt");
    inFlightKey.current = clientRequestId;
    setInFlight(true);
    setTicket({ phase: "SUBMITTING", clientRequestId, result: null, error: null });

    const executionType: TradingExecutionType = "PLACE_ORDER";
    const payload: UnifiedExecutePayload = {
      accountId: account.accountId,
      clientRequestId,
      executionType,
      symbol: symbol.toUpperCase(),
      side,
      volume: parsedVolume,
      kind: orderType === "market" ? "MARKET" : orderType === "limit" ? "LIMIT" : "STOP",
      price: orderType !== "market" && parsedPrice > 0 ? parsedPrice : null,
      stopLoss: parsedSL > 0 ? parsedSL : null,
      takeProfit: parsedTP > 0 ? parsedTP : null,
    };
    unresolvedPayload.current = payload;
    try {
      const user = auth.currentUser;
      if (!user) throw new UnifiedExecutionError("Not authenticated.", { code: "PERMISSION_DENIED", status: 0, result: null });
      const token = await user.getIdToken();

      const result = await executeUnified(payload, token);
      unresolvedPayload.current = null;

      // The server's terminal state, verbatim — no upgrade, no timeout.
      setTicket({
        phase: phaseFromStatus(result.status),
        clientRequestId,
        result,
        error: null,
      });
      onOrderPlaced(result.clientRequestId);
    } catch (err) {
      const message =
        err instanceof UnifiedExecutionError
          ? `${err.message} [${err.code}]`
          : friendlyMessage("UNKNOWN_PROVIDER_ERROR");
      setError(message);
      if (!isUnknownOutcome(err)) unresolvedPayload.current = null;
      // A timeout/transport loss is NOT a confirmed failure: keep the request id
      // visible and lock submission until the server confirms the outcome.
      const settled = err instanceof UnifiedExecutionError ? err.result : null;
      setTicket((prev) =>
        prev
          ? {
              ...prev,
              phase: isUnknownOutcome(err)
                ? "UNRESOLVED"
                : settled
                  ? phaseFromStatus(settled.status)
                  : "FAILED",
              result: settled ?? prev.result,
              error: message,
            }
          : prev
      );
    } finally {
      inFlightKey.current = null;
      setInFlight(false);
    }
  }

  const statusBadge = ticket ? (
    <Badge
      className={cn(
        "gap-1",
        PHASE_TONE[ticket.phase] === "good" && "border-positive/30 bg-positive/10 text-positive",
        PHASE_TONE[ticket.phase] === "progress" && "border-info/30 bg-info/10 text-info",
        PHASE_TONE[ticket.phase] === "bad" && "border-negative/30 bg-negative/10 text-negative",
        PHASE_TONE[ticket.phase] === "warn" && "border-warning/30 bg-warning/10 text-warning",
        PHASE_TONE[ticket.phase] === "neutral" && "border-border bg-muted text-muted-foreground"
      )}
    >
      {PHASE_TONE[ticket.phase] === "progress" ? (
        <Loader2 className="size-3 animate-spin" />
      ) : null}
      {PHASE_LABEL[ticket.phase]}
    </Badge>
  ) : null;

  const executionDetails = useMemo(() => {
    if (!ticket?.result) return null;
    const r = ticket.result;
    return (
      <div className="space-y-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-micro leading-4">
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Symbol</span>
          <span className="font-numeric font-medium">{r.executionType === "PLACE_ORDER" ? symbol.toUpperCase() : "—"}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Side / Type</span>
          <span className="font-numeric font-medium">
            {side} · {r.executionType}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Volume</span>
          <span className="font-numeric font-medium">
            {r.filledVolume !== null ? `${r.filledVolume} lots` : `${parsedVolume} lots (requested)`}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Ticket</span>
          <span className="font-numeric font-medium">{r.providerRef ?? "pending sync"}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Exec. price</span>
          <span className="font-numeric font-medium">{formatPrice(r.filledPrice)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Provider / Account</span>
          <span className="font-numeric font-medium">
            {r.provider} · {account?.mt5Account ?? r.accountId}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Time</span>
          <span className="font-numeric font-medium">
            {formatTime(r.completedAt ?? r.createdAt)}
          </span>
        </div>
      </div>
    );
  }, [ticket, symbol, side, parsedVolume, account]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-border/70 bg-muted/50 text-muted-foreground">
              <Zap size={13} />
            </span>
            Place Order
          </span>
          {statusBadge}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Symbol */}
        <div className="space-y-1.5">
          <label className="text-micro font-medium text-muted-foreground">Symbol</label>
          <Input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="XAUUSD"
            disabled={processing}
          />
        </div>

        {/* Side */}
        <div className="space-y-1.5">
          <label className="text-micro font-medium text-muted-foreground">Side</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={processing}
              onClick={() => setSide("BUY")}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg border py-2 text-sm font-semibold transition-all active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
                side === "BUY"
                  ? "border-positive/50 bg-positive/15 text-positive shadow-sm ring-1 ring-positive/20"
                  : "border-border bg-background text-muted-foreground hover:border-foreground/20 hover:bg-muted/60 hover:text-foreground"
              )}
            >
              <ArrowUpRight size={14} />
              BUY
            </button>
            <button
              type="button"
              disabled={processing}
              onClick={() => setSide("SELL")}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg border py-2 text-sm font-semibold transition-all active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
                side === "SELL"
                  ? "border-negative/50 bg-negative/15 text-negative shadow-sm ring-1 ring-negative/20"
                  : "border-border bg-background text-muted-foreground hover:border-foreground/20 hover:bg-muted/60 hover:text-foreground"
              )}
            >
              <ArrowDownRight size={14} />
              SELL
            </button>
          </div>
        </div>

        {/* Volume */}
        <div className="space-y-1.5">
          <label className="text-micro font-medium text-muted-foreground">Volume</label>
          <Input
            type="number"
            value={volume}
            onChange={(e) => setVolume(e.target.value)}
            step="0.01"
            min="0.01"
            disabled={processing}
          />
        </div>

        {/* Order Type */}
        <div className="space-y-1.5">
          <label className="text-micro font-medium text-muted-foreground">Order Type</label>
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
            {(["market", "limit", "stop"] as OrderType[]).map((type) => (
              <button
                key={type}
                type="button"
                disabled={processing}
                onClick={() => setOrderType(type)}
                className={cn(
                  "rounded-md px-2 py-1.5 text-xs font-medium capitalize transition-all disabled:pointer-events-none disabled:opacity-50",
                  orderType === type
                    ? "bg-foreground text-background shadow-sm"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                )}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Price (limit/stop only) */}
        {orderType !== "market" && (
          <div className="space-y-1.5">
            <label className="text-micro font-medium text-muted-foreground">Price</label>
            <Input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              step="0.01"
              disabled={processing}
            />
          </div>
        )}

        {/* SL / TP */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <label className="text-micro font-medium text-muted-foreground">Stop Loss</label>
            <Input
              type="number"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              placeholder="0.00"
              step="0.01"
              disabled={processing}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-micro font-medium text-muted-foreground">Take Profit</label>
            <Input
              type="number"
              value={takeProfit}
              onChange={(e) => setTakeProfit(e.target.value)}
              placeholder="0.00"
              step="0.01"
              disabled={processing}
            />
          </div>
        </div>

        <Separator />

        {/* Risk / Margin */}
        <div className="space-y-1.5 text-micro">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-2">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Shield size={12} className="shrink-0" />
              Est. Risk
            </span>
            <span className="font-numeric font-semibold text-foreground">${formatCurrency(estimatedRisk)}</span>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-2">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <AlertTriangle size={12} className="shrink-0" />
              Est. Margin
            </span>
            <span className="font-numeric font-semibold text-foreground">${formatCurrency(estimatedMargin)}</span>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-negative/30 bg-negative/10 px-3 py-2 text-xs text-negative">
            {error}
          </div>
        )}

        {unresolved && ticket ? (
          <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <p>
              Request <span className="font-numeric font-medium">{ticket.clientRequestId}</span> is
              unresolved. Check the MT5 terminal for this order before placing another.
            </p>
            <Button variant="outline" size="sm" onClick={handleReconcile} disabled={inFlight}>
              Check status
            </Button>
          </div>
        ) : null}

        {executionDetails}

        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={cn(
            "w-full font-semibold shadow-sm",
            side === "BUY"
              ? "border-positive/50 bg-positive/15 text-positive hover:border-positive/70 hover:bg-positive/25"
              : "border-negative/50 bg-negative/15 text-negative hover:border-negative/70 hover:bg-negative/25"
          )}
        >
          {processing ? "Submitting…" : `PLACE ${side} ORDER`}
        </Button>

        <p className="text-micro leading-4 text-muted-foreground">
          Orders execute on your connected <span className="font-medium">DEMO</span> account
          through the AlgoVault Unified Trading API. Fills are confirmed by the
          broker, never simulated.
        </p>
      </CardContent>
    </Card>
  );
}
