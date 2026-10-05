"use client";

/**
 * AnalyticsSettings — what we collect, and how to opt out.
 *
 * Privacy transparency is a product requirement, not a legal afterthought. This
 * panel states plainly what is recorded, what is never recorded, and gives the
 * user a real, immediate opt-out that stops collection in this browser
 * without deleting their product data or their subscription.
 */

import { useCallback, useSyncExternalStore } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isOptedOut, setOptedOut } from "@/lib/product-analytics/client";

const NEVER_COLLECTED = [
    "Broker credentials, server names, or account numbers",
    "Your private positions, orders, or P&L",
    "Free-text notes, journal entries, or chat content",
    "Your email address, name, or phone number",
];

const COLLECTED = [
    "Which product workflows you use, and how often",
    "The market symbol and timeframe you are looking at",
    "Which pages and features you open",
    "Whether you reached a Pro capability, and which one",
];

/**
 * The opt-out preference lives in localStorage, which is an external store.
 * `useSyncExternalStore` subscribes to it correctly on both the server render
 * (returns false, matching the default) and the client, so there is no
 * hydration mismatch and no cascading render.
 */
const subscribe = () => () => {};
const getSnapshot = () => isOptedOut();
const getServerSnapshot = () => false;

export function AnalyticsSettings({ className }: { className?: string }) {
    const optOut = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    const toggle = useCallback((next: boolean) => setOptedOut(next), []);

    return (
        <div className={`rounded-lg border border-border p-5 ${className ?? ""}`} data-testid="analytics-settings">
            <div className="mb-4 flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    {optOut ? <ShieldOff className="h-4 w-4" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
                </div>
                <div>
                    <h2 className="text-sm font-semibold text-foreground">Product analytics</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                        We use this to understand which parts of AlgoVault are useful and which need work. It is
                        behaviour data about the product — never about your trading.
                    </p>
                </div>
            </div>

            <div className="mb-4 grid gap-4 sm:grid-cols-2">
                <div>
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        What is recorded
                    </p>
                    <ul className="space-y-1">
                        {COLLECTED.map((item) => (
                            <li key={item} className="flex items-start gap-1.5 text-xs text-foreground">
                                <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                                {item}
                            </li>
                        ))}
                    </ul>
                </div>
                <div>
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        What is never recorded
                    </p>
                    <ul className="space-y-1">
                        {NEVER_COLLECTED.map((item) => (
                            <li key={item} className="flex items-start gap-1.5 text-xs text-foreground">
                                <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                                {item}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <p className="text-xs text-muted-foreground">
                    {optOut
                        ? "Analytics are off in this browser. The product works exactly the same."
                        : "Analytics are on. You can turn them off at any time."}
                </p>
                <Button variant={optOut ? "default" : "outline"} size="sm" onClick={() => toggle(!optOut)}>
                    {optOut ? "Turn analytics on" : "Turn analytics off"}
                </Button>
            </div>
        </div>
    );
}
