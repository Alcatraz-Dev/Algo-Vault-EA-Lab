"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/loading-state";
import { FormField, FormError, FormSuccess } from "@/components/ui/form-field";
import { useAdminFetch } from "@/components/growth/admin/useAdminFetch";
import { adminFetch } from "@/components/growth/admin/session";
import { RefreshButton } from "@/components/growth/admin/RefreshButton";
import { PREMIUM_AD_MODES } from "@/lib/growth/constants";

type Settings = {
    enabled: boolean;
    premiumMode: "SHOW" | "REDUCED" | "HIDE";
    premiumReductionRatio?: number;
    globalDailyCap?: number;
    currency?: string;
};

const inputCls = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

export default function AdminSettingsPage() {
    const settings = useAdminFetch<Settings | null>("/api/growth/settings");

    const [enabled, setEnabled] = useState(true);
    const [premiumMode, setPremiumMode] = useState<"SHOW" | "REDUCED" | "HIDE">("SHOW");
    const [reductionRatio, setReductionRatio] = useState("0.5");
    const [globalDailyCap, setGlobalDailyCap] = useState("");
    const [currency, setCurrency] = useState("USD");
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [ok, setOk] = useState<string | null>(null);

    // Hydrate the form once from the server payload (fetch is async, so this is
    // the pragmatic seed point; matches repo convention for form hydration).
    useEffect(() => {
        if (!settings.loading && settings.data) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setEnabled(settings.data.enabled ?? true);
            setPremiumMode(settings.data.premiumMode ?? "SHOW");
            setReductionRatio(settings.data.premiumReductionRatio != null ? String(settings.data.premiumReductionRatio) : "0.5");
            setGlobalDailyCap(settings.data.globalDailyCap != null ? String(settings.data.globalDailyCap) : "");
            setCurrency(settings.data.currency || "USD");
            setDirty(false);
        }
    }, [settings.data, settings.loading]);

    const mark = () => setDirty(true);

    const save = async () => {
        if (busy) return;
        if (premiumMode === "REDUCED") {
            const r = Number(reductionRatio);
            if (!Number.isFinite(r) || r < 0 || r > 1) {
                setErr("Reduction ratio must be between 0 and 1.");
                return;
            }
        }
        if (globalDailyCap && (!Number.isFinite(Number(globalDailyCap)) || Number(globalDailyCap) < 0)) {
            setErr("Daily cap must be a non-negative number (empty = unlimited).");
            return;
        }
        if (!currency.trim()) {
            setErr("Currency is required.");
            return;
        }
        setErr(null);
        setBusy(true);
        try {
            await adminFetch("/api/growth/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    enabled,
                    premiumMode,
                    ...(premiumMode === "REDUCED" ? { premiumReductionRatio: Number(reductionRatio) } : {}),
                    globalDailyCap: globalDailyCap ? Number(globalDailyCap) : undefined,
                    currency: currency.trim().toUpperCase(),
                } satisfies Partial<Settings>),
            });
            setOk("Settings saved — the placement engine picks them up immediately.");
            setDirty(false);
            settings.refresh();
            window.setTimeout(() => setOk(null), 6000);
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Could not save settings.");
        } finally {
            setBusy(false);
        }
    };

    if (settings.loading) {
        return (
            <div className="space-y-4" role="status" aria-label="Loading settings">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-72" />
            </div>
        );
    }

    if (settings.error) {
        return (
            <ErrorState
                title="Couldn't load settings"
                description={settings.error}
                action={<Button type="button" variant="outline" onClick={settings.refresh}>Retry</Button>}
            />
        );
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Monetization settings"
                subtitle="Engine-wide defaults for ad rendering and premium handling."
                actions={<RefreshButton onRefresh={settings.refresh} loading={settings.loading} />}
            />

            <div className="space-y-6 rounded-lg border border-border bg-card p-4 sm:p-6">
                {err && <FormError>{err}</FormError>}
                {ok && <FormSuccess>{ok}</FormSuccess>}

                <label className="flex items-center gap-2 text-sm text-foreground">
                    <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); mark(); }} className="h-4 w-4" />
                    Monetization enabled
                </label>
                <p className="text-xs text-muted-foreground">
                    When off, no ad slot renders for any visitor and placements are ignored by the engine. (Network-level configuration is still handled by
                    environment variables — see Ad networks.)
                </p>

                <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label="Premium handling (default)" htmlFor="set-premium">
                        <select id="set-premium" className={inputCls} value={premiumMode} onChange={(e) => { setPremiumMode(e.target.value as "SHOW" | "REDUCED" | "HIDE"); mark(); }}>
                            {PREMIUM_AD_MODES.map((m) => (
                                <option key={m} value={m}>
                                    {m === "SHOW" ? "Show ads to everyone" : m === "REDUCED" ? "Reduce ads for premium users" : "Hide ads from premium users"}
                                </option>
                            ))}
                        </select>
                    </FormField>
                    {premiumMode === "REDUCED" && (
                        <FormField label="Reduction ratio (0–1)" htmlFor="set-ratio">
                            <input
                                id="set-ratio"
                                type="number"
                                min={0}
                                max={1}
                                step={0.05}
                                className={inputCls}
                                value={reductionRatio}
                                onChange={(e) => { setReductionRatio(e.target.value); mark(); }}
                            />
                        </FormField>
                    )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label="Global daily cap (anonymous visitors)" htmlFor="set-cap">
                        <input
                            id="set-cap"
                            type="number"
                            min={0}
                            className={inputCls}
                            value={globalDailyCap}
                            onChange={(e) => { setGlobalDailyCap(e.target.value); mark(); }}
                            placeholder="Empty = unlimited"
                        />
                    </FormField>
                    <FormField label="Display currency" htmlFor="set-currency">
                        <input
                            id="set-currency"
                            className={inputCls}
                            value={currency}
                            maxLength={3}
                            onChange={(e) => { setCurrency(e.target.value.toUpperCase()); mark(); }}
                            placeholder="USD"
                        />
                    </FormField>
                </div>

                <div className="flex items-center gap-2 border-t border-border/60 pt-4">
                    <Button type="button" disabled={busy || !dirty} onClick={() => void save()}>
                        <Save /> {busy ? "Saving…" : "Save settings"}
                    </Button>
                    {dirty && <span className="text-xs text-muted-foreground">You have unsaved changes.</span>}
                </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-2 text-sm font-medium text-foreground">Where the defaults apply</h2>
                <p className="text-xs text-muted-foreground">
                    These values are the engine defaults; a placement or ad can override the premium handling with its own targeting rules. AdMob remains a
                    mobile-only network and is never rendered in the web app.
                </p>
            </div>
        </div>
    );
}