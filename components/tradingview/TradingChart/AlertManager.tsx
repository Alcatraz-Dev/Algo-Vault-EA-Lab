"use client";

import { useState } from "react";
import { Bell, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import type { PriceAlert } from "./types";

interface AlertManagerProps {
    alerts: PriceAlert[];
    onChange: (alerts: PriceAlert[]) => void;
}

export default function AlertManager({ alerts, onChange }: AlertManagerProps) {
    const [open, setOpen] = useState(false);

    function toggleAlert() {
        const newAlert: PriceAlert = {
            id: `alert-${Date.now()}`,
            symbol: "current",
            price: 0,
            direction: "above",
            triggered: false,
        };
        onChange([...alerts, newAlert]);
    }

    function removeAlert(id: string) {
        onChange(alerts.filter((a) => a.id !== id));
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger>
                <Button variant="ghost" size="sm" className="gap-1.5">
                    <Bell size={14} />
                    <span className="hidden sm:inline">Alert</span>
                    {alerts.length > 0 && (
                        <span className="rounded-full bg-cyan-400/20 px-1.5 py-0.5 text-[10px] font-medium text-cyan-300">
                            {alerts.length}
                        </span>
                    )}
                </Button>
            </DialogTrigger>
            <DialogContent className="bg-background border-border/20">
                <DialogHeader>
                    <DialogTitle className="text-foreground text-sm font-semibold">Price Alerts</DialogTitle>
                </DialogHeader>
                <div className="space-y-2 max-h-64 overflow-auto">
                    {alerts.length === 0 && (
                        <p className="text-xs text-foreground/70">No alerts set.</p>
                    )}
                    {alerts.map((alert) => (
                        <div
                            key={alert.id}
                            className="flex items-center justify-between rounded-lg border border-border/20 bg-background/20 px-3 py-2"
                        >
                            <div>
                                <p className="text-xs text-foreground">
                                    {alert.symbol} {alert.direction} {alert.price}
                                </p>
                                <p className="text-[10px] text-foreground/70">{alert.label || "No label"}</p>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-muted-foreground hover:text-rose-300"
                                onClick={() => removeAlert(alert.id)}
                            >
                                <Trash2 size={12} />
                            </Button>
                        </div>
                    ))}
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    className="border-border/20 text-xs text-foreground/70 hover:text-foreground"
                    onClick={toggleAlert}
                >
                    Add Alert
                </Button>
            </DialogContent>
        </Dialog>
    );
}
