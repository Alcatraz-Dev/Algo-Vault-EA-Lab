"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

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

function formatNumber(value: number, decimals = 2): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export default function OpenPositions({
  positions,
  onClose,
  onPartialClose,
  onModify,
}: {
  positions: Position[];
  onClose: (ticket: string) => void;
  onPartialClose: (ticket: string, volume: number) => void;
  onModify: (ticket: string, sl: number, tp: number) => void;
}) {
  const [partialCloseTicket, setPartialCloseTicket] = useState<string | null>(null);
  const [partialCloseVolume, setPartialCloseVolume] = useState("0.01");
  const [modifyTicket, setModifyTicket] = useState<string | null>(null);
  const [modifySL, setModifySL] = useState("");
  const [modifyTP, setModifyTP] = useState("");

  const totalProfit = positions.reduce((sum, p) => sum + p.profit, 0);

  function handlePartialClose() {
    if (partialCloseTicket && parseFloat(partialCloseVolume) > 0) {
      onPartialClose(partialCloseTicket, parseFloat(partialCloseVolume));
      setPartialCloseTicket(null);
      setPartialCloseVolume("0.01");
    }
  }

  function handleModify() {
    if (modifyTicket) {
      onModify(modifyTicket, parseFloat(modifySL) || 0, parseFloat(modifyTP) || 0);
      setModifyTicket(null);
      setModifySL("");
      setModifyTP("");
    }
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
              {totalProfit >= 0 ? "+" : ""}
              ${formatNumber(totalProfit)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Volume</TableHead>
                <TableHead className="text-right">Entry</TableHead>
                <TableHead className="text-right">Current</TableHead>
                <TableHead className="text-right">SL / TP</TableHead>
                <TableHead className="text-right">P/L</TableHead>
                <TableHead className="text-right">Ticket</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.map((pos) => (
                <TableRow key={pos.ticket}>
                  <TableCell className="font-semibold">{pos.symbol}</TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 font-semibold",
                        pos.type === "BUY" ? "text-emerald-500" : "text-rose-500"
                      )}
                    >
                      {pos.type}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatNumber(pos.volume)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatNumber(pos.openPrice, 5)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatNumber(pos.currentPrice, 5)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                    {pos.sl > 0 ? formatNumber(pos.sl, 5) : "—"} /{" "}
                    {pos.tp > 0 ? formatNumber(pos.tp, 5) : "—"}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono font-semibold tabular-nums",
                      pos.profit >= 0 ? "text-emerald-500" : "text-rose-500"
                    )}
                  >
                    {pos.profit >= 0 ? "+" : ""}
                    ${formatNumber(pos.profit)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {pos.ticket}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => setPartialCloseTicket(pos.ticket)}
                            />
                          }
                        >
                          <ChevronDown size={12} />
                        </TooltipTrigger>
                        <TooltipContent>Partial Close</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => openModifyDialog(pos)}
                            />
                          }
                        >
                          <span className="text-xs">M</span>
                        </TooltipTrigger>
                        <TooltipContent>Modify SL/TP</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="destructive"
                              size="icon-xs"
                              onClick={() => onClose(pos.ticket)}
                            />
                          }
                        >
                          <X size={12} />
                        </TooltipTrigger>
                        <TooltipContent>Close Position</TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Partial Close Dialog */}
      <Dialog open={!!partialCloseTicket} onOpenChange={(open) => !open && setPartialCloseTicket(null)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Partial Close</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-muted-foreground">Volume to Close</label>
            <Input
              type="number"
              value={partialCloseVolume}
              onChange={(e) => setPartialCloseVolume(e.target.value)}
              step="0.01"
              min="0.01"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPartialCloseTicket(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handlePartialClose}
              disabled={parseFloat(partialCloseVolume) <= 0}
            >
              Close Partial
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modify Dialog */}
      <Dialog open={!!modifyTicket} onOpenChange={(open) => !open && setModifyTicket(null)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Modify SL/TP</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-muted-foreground">Stop Loss</label>
            <Input
              type="number"
              value={modifySL}
              onChange={(e) => setModifySL(e.target.value)}
              placeholder="0.00"
              step="0.01"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-muted-foreground">Take Profit</label>
            <Input
              type="number"
              value={modifyTP}
              onChange={(e) => setModifyTP(e.target.value)}
              placeholder="0.00"
              step="0.01"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModifyTicket(null)}>
              Cancel
            </Button>
            <Button onClick={handleModify}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
