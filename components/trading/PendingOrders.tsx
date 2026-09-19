"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PendingOrder {
  ticket: string;
  symbol: string;
  type: string;
  volume: number;
  price: number;
  sl: number;
  tp: number;
  status: string;
  updatedAt: number;
}

function formatNumber(value: number, decimals = 2): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  return (
    <Badge
      className={cn(
        "border-none",
        s === "active" || s === "placed"
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : s === "cancelled"
          ? "bg-muted text-muted-foreground"
          : "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
      )}
    >
      {status}
    </Badge>
  );
}

export default function PendingOrders({
  orders,
  onCancel,
}: {
  orders: PendingOrder[];
  onCancel: (ticket: string) => void;
}) {
  if (orders.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Pending Orders</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8 text-sm text-muted-foreground">
          No pending orders.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending Orders ({orders.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Volume</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">SL / TP</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <TableRow key={order.ticket}>
                <TableCell className="font-semibold">{order.symbol}</TableCell>
                <TableCell>
                  <span
                    className={cn(
                      "font-semibold",
                      order.type.toUpperCase().includes("BUY") || order.type.toUpperCase() === "BUYLIMIT" || order.type.toUpperCase() === "BUYSTOP"
                        ? "text-emerald-500"
                        : "text-rose-500"
                    )}
                  >
                    {order.type}
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatNumber(order.volume)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatNumber(order.price, 5)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                  {order.sl > 0 ? formatNumber(order.sl, 5) : "—"} /{" "}
                  {order.tp > 0 ? formatNumber(order.tp, 5) : "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge status={order.status} />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="destructive"
                    size="icon-xs"
                    onClick={() => onCancel(order.ticket)}
                  >
                    <X size={12} />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
