"use client";

import { useState } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TradingAccount } from "./AccountHeader";

type OrderType = "market" | "limit" | "stop";
type OrderSide = "BUY" | "SELL";
type OrderStatus = "idle" | "pending" | "queued" | "executing" | "filled" | "rejected";

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function OrderPanel({
  account,
  onOrderPlaced,
}: {
  account: TradingAccount | null;
  onOrderPlaced: (clientOrderId: string) => void;
}) {
  const [symbol, setSymbol] = useState("XAUUSD");
  const [side, setSide] = useState<OrderSide>("BUY");
  const [volume, setVolume] = useState("0.01");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [price, setPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [status, setStatus] = useState<OrderStatus>("idle");
  const [error, setError] = useState("");

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
      ? parsedVolume * (parsedPrice || account.balance) / parseFloat(account.leverage || "100")
      : 0;

  const isProcessing = ["pending", "queued", "executing"].includes(status);
  const canSubmit = account?.status === "connected" && parsedVolume >= 0.01 && !isProcessing;

  async function handleSubmit() {
    if (!canSubmit) return;
    setError("");
    setStatus("pending");

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Not authenticated");
      const token = await user.getIdToken();

      const clientOrderId = `coid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const res = await fetch("/api/trading/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          clientOrderId,
          accountId: account!.accountId,
          symbol: symbol.toUpperCase(),
          action: side,
          volume: parsedVolume,
          price: orderType !== "market" ? parsedPrice : undefined,
          sl: parsedSL > 0 ? parsedSL : undefined,
          tp: parsedTP > 0 ? parsedTP : undefined,
          orderType,
        }),
      });

      setStatus("queued");

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Order failed (${res.status})`);
      }

      setStatus("executing");
      setTimeout(() => {
        setStatus("filled");
        onOrderPlaced(clientOrderId);
        setTimeout(() => setStatus("idle"), 3000);
      }, 1500);
    } catch (err: any) {
      setStatus("rejected");
      setError(err?.message || "Order failed");
    }
  }

  const statusBadge = () => {
    switch (status) {
      case "pending":
        return <Badge className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">Pending</Badge>;
      case "queued":
        return <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400">Queued</Badge>;
      case "executing":
        return <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400">Executing</Badge>;
      case "filled":
        return <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">Filled</Badge>;
      case "rejected":
        return <Badge className="bg-rose-500/10 text-rose-600 dark:text-rose-400">Rejected</Badge>;
      default:
        return null;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Zap size={14} />
            Place Order
          </span>
          {statusBadge()}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Symbol */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground">Symbol</label>
          <Input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="XAUUSD"
            disabled={isProcessing}
          />
        </div>

        {/* Side */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground">Side</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={isProcessing}
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
              disabled={isProcessing}
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
          <label className="text-[11px] font-medium text-muted-foreground">Volume</label>
          <Input
            type="number"
            value={volume}
            onChange={(e) => setVolume(e.target.value)}
            step="0.01"
            min="0.01"
            disabled={isProcessing}
          />
        </div>

        {/* Order Type */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground">Order Type</label>
          <div className="grid grid-cols-3 gap-1 rounded-none border border-border p-0.5">
            {(["market", "limit", "stop"] as OrderType[]).map((type) => (
              <button
                key={type}
                type="button"
                disabled={isProcessing}
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
            <label className="text-[11px] font-medium text-muted-foreground">Price</label>
            <Input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              step="0.01"
              disabled={isProcessing}
            />
          </div>
        )}

        {/* SL / TP */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">Stop Loss</label>
            <Input
              type="number"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              placeholder="0.00"
              step="0.01"
              disabled={isProcessing}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground">Take Profit</label>
            <Input
              type="number"
              value={takeProfit}
              onChange={(e) => setTakeProfit(e.target.value)}
              placeholder="0.00"
              step="0.01"
              disabled={isProcessing}
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
          {isProcessing ? "Processing..." : `PLACE ${side} ORDER`}
        </Button>
      </CardContent>
    </Card>
  );
}
