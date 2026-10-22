"use client";

/**
 * Open Positions panel — Unified Trading API edition.
 *
 * Every action (modify SL/TP, partial close, full close) goes through
 * `POST /api/trading/execute` → UnifiedTradingService. Panel-local state is
 * display only: positions, volumes and P/L always come from the synced RTDB
 * snapshot, never from what this component last clicked.
 *
 * Partial close semantics (the Challenge Area bug this must never repeat):
 * percentage is a share of the CURRENT POSITION VOLUME, never of floating
 * profit. 25% of 0.20 lots closes 0.05 lots and leaves 0.15 open; realized
 * P/L stays proportional by volume and is reported by the provider, not
 * computed here. The server recomputes and re-validates the volume anyway —
 * the client preview is informational, never authoritative.
 */

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Loader2,
  X,
  ChevronDown,
  SlidersHorizontal,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { friendlyMessage } from "@/lib/trading/unified/client";

export interface Position {
  ticket: string;
  symbol: string;
  type: "BUY" | "SELL";
  volume: number;
  openPrice: number;
  currentPrice: number;
  sl: number;
  tp: number;
  profit: number;
  swap: number;
  magic: number;
  openedAt: number;
}

export interface PositionActionHandlers {
  /** positionId is the synced position ticket (providerRef). */
  onModify: (positionId: string, stopLoss: number | null, takeProfit: number | null) => Promise<void>;
  /** percentage is % of CURRENT POSITION VOLUME (1–100). */
  onPartialClose: (positionId: string, percentage: number) => Promise<void>;
  onClose: (positionId: string) => Promise<void>;
  /** Fires on any rejection so the parent can surface a durable message. */
  onActionError?: (message: string) => void;
}

function formatNumber(value: number, decimals = 2): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Informational preview of the volume a percentage close would close. */
function previewPartialVolume(volume: number, percent: number): { volume: number; remaining: number; roundsToFull: boolean } {
  const step = 0.01;
  const min = 0.01;
  const raw = volume * (percent / 100);
  let close = Math.floor(raw / step + 1e-9) * step;
  close = Math.round(close * 1_000_000) / 1_000_000;
  const remaining = Math.round((volume - close) * 1_000_000) / 1_000_000;
  if (percent >= 100 || close >= volume || close < min || remaining < min) {
    return { volume, remaining: 0, roundsToFull: true };
  }
  return { volume: close, remaining, roundsToFull: false };
}

export default function OpenPositions({
  positions,
  onModify,
  onPartialClose,
  onClose,
  onActionError,
  busyTickets = [],
}: {
  positions: Position[];
  busyTickets?: string[];
} & PositionActionHandlers) {
  const [partialTicket, setPartialTicket] = useState<string | null>(null);
  const [partialPercent, setPartialPercent] = useState("50");
  const [modifyTicket, setModifyTicket] = useState<string | null>(null);
  const [modifySL, setModifySL] = useState("");
  const [modifyTP, setModifyTP] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const totalProfit = positions.reduce((sum, p) => sum + p.profit, 0);

  const partialPreview = useMemo(() => {
    const pos = positions.find((p) => p.ticket === partialTicket);
    const percent = parseFloat(partialPercent);
    if (!pos || !Number.isFinite(percent) || percent <= 0) return null;
    return { pos, ...previewPartialVolume(pos.volume, percent) };
  }, [positions, partialTicket, partialPercent]);

  async function run(action: () => Promise<unknown>, ticket: string) {
    setBusy(ticket);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  }

  function handlePartialConfirm() {
    if (!partialTicket || !partialPreview) return;
    void run(async () => {
      try {
        await onPartialClose(partialTicket, parseFloat(partialPercent));
      } catch (err) {
        onActionError?.(err instanceof Error ? err.message : friendlyMessage("UNKNOWN_PROVIDER_ERROR"));
      }
      setPartialTicket(null);
    }, partialTicket);
  }

  function handleModifyConfirm() {
    if (!modifyTicket) return;
    const sl = parseFloat(modifySL);
    const tp = parseFloat(modifyTP);
    void run(async () => {
      try {
        await onModify(modifyTicket, Number.isFinite(sl) && sl > 0 ? sl : null, Number.isFinite(tp) && tp > 0 ? tp : null);
      } catch (err) {
        onActionError?.(err instanceof Error ? err.message : friendlyMessage("UNKNOWN_PROVIDER_ERROR"));
      }
      setModifyTicket(null);
    }, modifyTicket);
  }

  function handleClose(ticket: string) {
    void run(async () => {
      try {
        await onClose(ticket);
      } catch (err) {
        onActionError?.(err instanceof Error ? err.message : friendlyMessage("UNKNOWN_PROVIDER_ERROR"));
      }
    }, ticket);
  }

  function openModifyDialog(pos: Position) {
    setModifyTicket(pos.ticket);
    setModifySL(pos.sl > 0 ? pos.sl.toString() : "");
    setModifyTP(pos.tp > 0 ? pos.tp.toString() : "");
  }

  if (positions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Open Positions</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8 text-sm text-muted-foreground">
          No open positions.
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2">
            {/* Title + live indicator */}
            <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-heading text-[13px] font-semibold tracking-tight">Open Positions</span>
              <span className="font-numeric text-sm font-semibold tabular-nums">({positions.length})</span>
              <span className="ml-1 flex items-center gap-1.5 text-micro text-muted-foreground">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-60 motion-reduce:animate-none" />
                  <span className="relative inline-flex size-2 rounded-full bg-positive" />
                </span>
                Live
              </span>
            </span>
            {/* Stats row */}
            <span className="grid min-w-0 grid-cols-3 gap-2 sm:flex sm:flex-1 sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1">
              <span className="flex items-baseline gap-1.5">
                <span className="text-micro text-muted-foreground">P/L</span>
                <span
                  className={cn(
                    "font-numeric text-sm font-semibold tabular-nums",
                    totalProfit >= 0 ? "text-positive" : "text-negative"
                  )}
                >
                  {totalProfit >= 0 ? "+" : ""}${formatNumber(totalProfit)}
                </span>
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-micro text-muted-foreground">Winners</span>
                <span className="font-numeric text-sm font-semibold tabular-nums text-positive">{positions.filter((p) => p.profit > 0).length}</span>
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-micro text-muted-foreground">Losses</span>
                <span className="font-numeric text-sm font-semibold tabular-nums text-negative">{positions.filter((p) => p.profit < 0).length}</span>
              </span>
            </span>
            {/* Bulk actions */}
            <span className="grid w-full grid-cols-3 divide-x divide-border/50 overflow-hidden rounded-lg border border-border/70 bg-card/60 shadow-sm sm:ml-auto sm:inline-flex sm:w-auto sm:max-w-full sm:shrink-0 sm:items-center">
              <button
                type="button"
                disabled={positions.filter((p) => p.profit > 0).length === 0}
                className="px-2.5 py-1 font-numeric text-[11px] font-medium text-foreground/70 transition-colors hover:bg-positive/10 hover:text-positive active:scale-[0.98] disabled:cursor-not-allowed disabled:text-muted-foreground/40 disabled:hover:bg-transparent"
                title={`Close all winning positions (${positions.filter((p) => p.profit > 0).length})`}
                onClick={async () => {
                  for (const p of positions.filter((p) => p.profit > 0)) {
                    await onClose(p.ticket);
                  }
                }}
              >
                <span className="font-bold">Win</span> {positions.filter((p) => p.profit > 0).length}
              </button>
              <button
                type="button"
                disabled={positions.filter((p) => p.profit < 0).length === 0}
                className="px-2.5 py-1 font-numeric text-[11px] font-medium text-foreground/70 transition-colors hover:bg-negative/10 hover:text-negative active:scale-[0.98] disabled:cursor-not-allowed disabled:text-muted-foreground/40 disabled:hover:bg-transparent"
                title={`Close all losing positions (${positions.filter((p) => p.profit < 0).length})`}
                onClick={async () => {
                  for (const p of positions.filter((p) => p.profit < 0)) {
                    await onClose(p.ticket);
                  }
                }}
              >
                <span className="font-bold">Loss</span> {positions.filter((p) => p.profit < 0).length}
              </button>
              <button
                type="button"
                disabled={positions.length === 0}
                className="bg-negative/10 px-2.5 py-1 font-numeric text-[11px] font-bold text-negative transition-colors hover:bg-negative/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-transparent disabled:text-muted-foreground/40"
                title="Close every open position"
                onClick={async () => {
                  for (const p of positions) {
                    await onClose(p.ticket);
                  }
                }}
              >
                <span>All</span> {positions.length}
              </button>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Mobile: stacked position cards (no horizontal table scroll) */}
          <ul className="flex flex-col gap-2 md:hidden">
            {positions.map((pos) => {
              const actionPending = busy === pos.ticket || busyTickets.includes(pos.ticket);
              const marginBase = pos.openPrice > 0 ? pos.volume * pos.openPrice * 100 : 0;
              const pnlPct = marginBase > 0 ? (pos.profit / marginBase) * 100 : null;
              return (
                <li
                  key={`m-${pos.ticket}`}
                  className="rounded-lg border border-border/70 bg-card/60 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-semibold">{pos.symbol}</span>
                      <span
                        className={cn(
                          "text-xs font-semibold",
                          pos.type === "BUY" ? "text-positive" : "text-negative"
                        )}
                      >
                        {pos.type}
                      </span>
                      {actionPending ? (
                        <Loader2 className="size-3 animate-spin text-muted-foreground" />
                      ) : null}
                    </div>
                    <span
                      className={cn(
                        "font-numeric text-sm font-semibold",
                        pos.profit >= 0 ? "text-positive" : "text-negative"
                      )}
                    >
                      {pos.profit >= 0 ? "+" : ""}${formatNumber(pos.profit)}
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Volume</dt>
                      <dd className="font-numeric">{formatNumber(pos.volume)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">P/L %</dt>
                      <dd className="font-numeric">
                        {pnlPct !== null ? `${pnlPct >= 0 ? "+" : ""}${formatNumber(pnlPct, 1)}%` : "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Entry</dt>
                      <dd className="font-numeric">{formatNumber(pos.openPrice, 5)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Current</dt>
                      <dd className="font-numeric">
                        {pos.currentPrice > 0 ? formatNumber(pos.currentPrice, 5) : "—"}
                      </dd>
                    </div>
                    <div className="col-span-2 flex justify-between">
                      <dt className="text-muted-foreground">SL / TP</dt>
                      <dd className="font-numeric text-muted-foreground">
                        {pos.sl > 0 ? formatNumber(pos.sl, 5) : "—"} /{" "}
                        {pos.tp > 0 ? formatNumber(pos.tp, 5) : "—"}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 pt-2">
                    <span className="font-numeric text-[11px] text-muted-foreground">#{pos.ticket}</span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={actionPending}
                        onClick={() => setPartialTicket(pos.ticket)}
                      >
                        Partial
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={actionPending}
                        onClick={() => openModifyDialog(pos)}
                      >
                        SL/TP
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={actionPending}
                        onClick={() => handleClose(pos.ticket)}
                      >
                        Close
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-micro uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Symbol</th>
                  <th className="py-2 pr-3 font-medium">Side</th>
                  <th className="py-2 pr-3 text-right font-medium">Volume</th>
                  <th className="py-2 pr-3 text-right font-medium">Entry</th>
                  <th className="py-2 pr-3 text-right font-medium">Current</th>
                  <th className="py-2 pr-3 text-right font-medium">SL / TP</th>
                  <th className="py-2 pr-3 text-right font-medium">P/L</th>
                  <th className="py-2 pr-3 text-right font-medium">P/L %</th>
                  <th className="py-2 pr-3 text-right font-medium">Ticket</th>
                  <th className="py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => {
                  const marginBase = pos.openPrice > 0 ? pos.volume * pos.openPrice * 100 : 0;
                  const pnlPct = marginBase > 0 ? (pos.profit / marginBase) * 100 : null;
                  const actionPending = busy === pos.ticket || busyTickets.includes(pos.ticket);
                  return (
                    <tr key={pos.ticket} className="border-b border-border/60 last:border-0">
                      <td className="py-2 pr-3 font-semibold">{pos.symbol}</td>
                      <td className="py-2 pr-3">
                        <span
                          className={cn(
                            "font-semibold",
                            pos.type === "BUY" ? "text-positive" : "text-negative"
                          )}
                        >
                          {pos.type}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right font-numeric">
                        {actionPending ? (
                          <Loader2 className="inline size-3 animate-spin text-muted-foreground" />
                        ) : null}
                        {formatNumber(pos.volume)}
                      </td>
                      <td className="py-2 pr-3 text-right font-numeric">
                        {formatNumber(pos.openPrice, 5)}
                      </td>
                      <td className="py-2 pr-3 text-right font-numeric">
                        {pos.currentPrice > 0 ? formatNumber(pos.currentPrice, 5) : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right font-numeric text-muted-foreground">
                        {pos.sl > 0 ? formatNumber(pos.sl, 5) : "—"} /{" "}
                        {pos.tp > 0 ? formatNumber(pos.tp, 5) : "—"}
                      </td>
                      <td
                        className={cn(
                          "py-2 pr-3 text-right font-numeric font-semibold",
                          pos.profit >= 0 ? "text-positive" : "text-negative"
                        )}
                      >
                        {pos.profit >= 0 ? "+" : ""}${formatNumber(pos.profit)}
                      </td>
                      <td className="py-2 pr-3 text-right font-numeric text-muted-foreground">
                        {pnlPct !== null ? `${pnlPct >= 0 ? "+" : ""}${formatNumber(pnlPct, 1)}%` : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right font-numeric text-muted-foreground">
                        {pos.ticket}
                      </td>
                      <td className="py-2">
                        <div className="flex items-center justify-end gap-1">
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  disabled={actionPending}
                                  onClick={() => setPartialTicket(pos.ticket)}
                                />
                              }
                            >
                              <ChevronDown size={12} />
                            </TooltipTrigger>
                            <TooltipContent>Partial close (% of volume)</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  disabled={actionPending}
                                  onClick={() => openModifyDialog(pos)}
                                />
                              }
                            >
                              <SlidersHorizontal size={12} />
                            </TooltipTrigger>
                            <TooltipContent>Modify SL/TP</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant="destructive"
                                  size="icon-xs"
                                  disabled={actionPending}
                                  onClick={() => handleClose(pos.ticket)}
                                />
                              }
                            >
                              <X size={12} />
                            </TooltipTrigger>
                            <TooltipContent>Close position</TooltipContent>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Partial Close dialog — percentage of CURRENT position volume */}
      <Dialog open={!!partialTicket} onOpenChange={(open) => !open && setPartialTicket(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Partial Close — {partialPreview?.pos.symbol ?? ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Percentage of position volume (1–100)
              </label>
              <Input
                type="number"
                value={partialPercent}
                onChange={(e) => setPartialPercent(e.target.value)}
                step="5"
                min="1"
                max="100"
              />
            </div>
            {partialPreview ? (
              <div className="space-y-1 rounded-none border border-border bg-muted/40 px-3 py-2 text-xs leading-4">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Open volume</span>
                  <span className="font-numeric font-medium">{formatNumber(partialPreview.pos.volume)} lots</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Will close</span>
                  <span className="font-numeric font-medium">
                    {partialPreview.roundsToFull
                      ? `${formatNumber(partialPreview.volume)} lots (full close)`
                      : `${formatNumber(partialPreview.volume)} lots`}
                  </span>
                </div>
                {!partialPreview.roundsToFull ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Will remain</span>
                    <span className="font-numeric font-medium">{formatNumber(partialPreview.remaining)} lots</span>
                  </div>
                ) : null}
                <p className="pt-1 text-micro text-muted-foreground">
                  Volume-based: realized P/L is the closed volume&apos;s share, reported by the
                  broker. Profit percentage is never used as volume.
                </p>
              </div>
            ) : (
              <p className="text-xs text-negative">Enter a percentage between 1 and 100.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPartialTicket(null)}>
              Cancel
            </Button>
            <Button
              onClick={handlePartialConfirm}
              disabled={!partialPreview || partialPreview.pos.volume <= 0}
            >
              Close {partialPercent || "—"}%
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modify SL/TP dialog */}
      <Dialog open={!!modifyTicket} onOpenChange={(open) => !open && setModifyTicket(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Modify SL/TP — {positions.find((p) => p.ticket === modifyTicket)?.symbol ?? ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Stop Loss</label>
              <Input
                type="number"
                value={modifySL}
                onChange={(e) => setModifySL(e.target.value)}
                placeholder="0.00 (none)"
                step="0.00001"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Take Profit</label>
              <Input
                type="number"
                value={modifyTP}
                onChange={(e) => setModifyTP(e.target.value)}
                placeholder="0.00 (none)"
                step="0.00001"
              />
            </div>
            <p className="flex items-center gap-1.5 text-micro text-muted-foreground">
              <ShieldAlert size={11} />
              The broker validates stop distance against the live price; a rejected
              modification is reported as-is.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModifyTicket(null)}>
              Cancel
            </Button>
            <Button onClick={handleModifyConfirm}>Apply Modification</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export { previewPartialVolume };
