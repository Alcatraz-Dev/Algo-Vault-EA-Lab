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
  type ClientDisplayPhase,
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
  const canSubmit =
    account?.status === "connected" &&
    parsedVolume >= 0.01 &&
    !processing &&
    !inFlight;

  async function handleSubmit() {
    if (!canSubmit || !account) return;
    if (inFlightKey.current !== null) return; // synchronous double-click guard
    setError("");

    const clientRequestId = newClientRequestId("pt");
    inFlightKey.current = clientRequestId;
    setInFlight(true);
    setTicket({ phase: "SUBMITTING", clientRequestId, result: null, error: null });

    const executionType: TradingExecutionType = "PLACE_ORDER";
    try {
      const user = auth.currentUser;
      if (!user) throw new UnifiedExecutionError("Not authenticated.", { code: "PERMISSION_DENIED", status: 0, result: null });
      const token = await user.getIdToken();

      const result = await executeUnified(
        {
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
        },
        token
      );

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
          ? err.message
          : friendlyMessage("UNKNOWN_PROVIDER_ERROR");
      setError(message);
      setTicket((prev) => (prev ? { ...prev, phase: "FAILED", error: message } : prev));
    } finally {
      inFlightKey.current = null;
      setInFlight(false);
    }
  }

  const statusBadge = ticket ? (
    <Badge
      className={cn(
        "gap-1",
        PHASE_TONE[ticket.phase] === "good" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        PHASE_TONE[ticket.phase] === "progress" && "bg-blue-500/10 text-blue-600 dark:text-blue-400",
        PHASE_TONE[ticket.phase] === "bad" && "bg-rose-500/10 text-rose-600 dark:text-rose-400",
        PHASE_TONE[ticket.phase] === "warn" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        PHASE_TONE[ticket.phase] === "neutral" && "bg-muted text-muted-foreground"
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
      <div className="space-y-1.5 rounded-none border border-border bg-muted/40 px-3 py-2 text-micro leading-4">
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Symbol</span>
          <span className="font-mono font-medium">{r.executionType === "PLACE_ORDER" ? symbol.toUpperCase() : "—"}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Side / Type</span>
          <span className="font-mono font-medium">
            {side} · {r.executionType}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Volume</span>
          <span className="font-mono font-medium">
            {r.filledVolume !== null ? `${r.filledVolume} lots` : `${parsedVolume} lots (requested)`}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Ticket</span>
          <span className="font-mono font-medium">{r.providerRef ?? "pending sync"}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Exec. price</span>
          <span className="font-mono font-medium">{formatPrice(r.filledPrice)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Provider / Account</span>
          <span className="font-mono font-medium">
            {r.provider} · {account?.mt5Account ?? r.accountId}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Time</span>
          <span className="font-mono font-medium">
            {formatTime(r.completedAt ?? r.createdAt)}
          </span>
        </div>
        {r.status === "EXECUTED_PENDING_SYNC" ? (
          <p className="pt-1 text-amber-600 dark:text-amber-400">
            Executed on the broker — the position will appear when the next
            account snapshot syncs.
          </p>
        ) : null}
      </div>
    );
  }, [ticket, symbol, side, parsedVolume, account]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Zap size={14} />
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
                "flex items-center justify-center gap-2 rounded-none border py-2 text-sm font-semibold transition-all",
                side === "BUY"
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-border text-muted-foreground hover:bg-muted"
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
                "flex items-center justify-center gap-2 rounded-none border py-2 text-sm font-semibold transition-all",
                side === "SELL"
                  ? "border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                  : "border-border text-muted-foreground hover:bg-muted"
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
          <div className="grid grid-cols-3 gap-1 rounded-none border border-border p-0.5">
            {(["market", "limit", "stop"] as OrderType[]).map((type) => (
              <button
                key={type}
                type="button"
                disabled={processing}
                onClick={() => setOrderType(type)}
                className={cn(
                  "rounded-none px-2 py-1.5 text-xs font-medium capitalize transition-all",
                  orderType === type
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted"
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
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Shield size={12} />
            <span>
              Est. Risk:{" "}
              <span className="font-mono font-semibold text-foreground">
                ${formatCurrency(estimatedRisk)}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertTriangle size={12} />
            <span>
              Est. Margin:{" "}
              <span className="font-mono font-semibold text-foreground">
                ${formatCurrency(estimatedMargin)}
              </span>
            </span>
          </div>
        </div>

        {error && (
          <div className="rounded-none border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
            {error}
          </div>
        )}

        {executionDetails}

        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={cn(
            "w-full font-semibold",
            side === "BUY"
              ? "bg-emerald-600 text-foreground hover:bg-emerald-700"
              : "bg-rose-600 text-foreground hover:bg-rose-700"
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
