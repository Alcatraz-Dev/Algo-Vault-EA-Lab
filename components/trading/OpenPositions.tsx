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
          <CardTitle className="flex items-center justify-between">
            <span>Open Positions ({positions.length})</span>
            <span
              className={cn(
                "font-mono text-sm font-semibold",
                totalProfit >= 0 ? "text-emerald-500" : "text-rose-500"
              )}
            >
              {totalProfit >= 0 ? "+" : ""}${formatNumber(totalProfit)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
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
                            pos.type === "BUY" ? "text-emerald-500" : "text-rose-500"
                          )}
                        >
                          {pos.type}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">
                        {actionPending ? (
                          <Loader2 className="inline size-3 animate-spin text-muted-foreground" />
                        ) : null}
                        {formatNumber(pos.volume)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">
                        {formatNumber(pos.openPrice, 5)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">
                        {pos.currentPrice > 0 ? formatNumber(pos.currentPrice, 5) : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-muted-foreground">
                        {pos.sl > 0 ? formatNumber(pos.sl, 5) : "—"} /{" "}
                        {pos.tp > 0 ? formatNumber(pos.tp, 5) : "—"}
                      </td>
                      <td
                        className={cn(
                          "py-2 pr-3 text-right font-mono font-semibold tabular-nums",
                          pos.profit >= 0 ? "text-emerald-500" : "text-rose-500"
                        )}
                      >
                        {pos.profit >= 0 ? "+" : ""}${formatNumber(pos.profit)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-muted-foreground">
                        {pnlPct !== null ? `${pnlPct >= 0 ? "+" : ""}${formatNumber(pnlPct, 1)}%` : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-muted-foreground">
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
              <label className="text-[11px] font-medium text-muted-foreground">
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
              <div className="space-y-1 rounded-none border border-border bg-muted/40 px-3 py-2 text-[11px] leading-4">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Open volume</span>
                  <span className="font-mono font-medium">{formatNumber(partialPreview.pos.volume)} lots</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Will close</span>
                  <span className="font-mono font-medium">
                    {partialPreview.roundsToFull
                      ? `${formatNumber(partialPreview.volume)} lots (full close)`
                      : `${formatNumber(partialPreview.volume)} lots`}
                  </span>
                </div>
                {!partialPreview.roundsToFull ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Will remain</span>
                    <span className="font-mono font-medium">{formatNumber(partialPreview.remaining)} lots</span>
                  </div>
                ) : null}
                <p className="pt-1 text-[10px] text-muted-foreground">
                  Volume-based: realized P/L is the closed volume&apos;s share, reported by the
                  broker. Profit percentage is never used as volume.
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-rose-500">Enter a percentage between 1 and 100.</p>
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
              <label className="text-[11px] font-medium text-muted-foreground">Stop Loss</label>
              <Input
                type="number"
                value={modifySL}
                onChange={(e) => setModifySL(e.target.value)}
                placeholder="0.00 (none)"
                step="0.00001"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-muted-foreground">Take Profit</label>
              <Input
                type="number"
                value={modifyTP}
                onChange={(e) => setModifyTP(e.target.value)}
                placeholder="0.00 (none)"
                step="0.00001"
              />
            </div>
            <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
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
