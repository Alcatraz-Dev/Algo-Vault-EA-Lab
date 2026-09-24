"use client";

import { Globe, Smartphone, Terminal, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/loading-state";
import { Badge } from "@/components/ui/badge";
import { useAdminFetch } from "@/components/growth/admin/useAdminFetch";
import { RefreshButton } from "@/components/growth/admin/RefreshButton";
import { GrowthStatusBadge } from "@/components/growth/admin/GrowthStatusBadge";

type NetworkStatus = {
    type: "ADSENSE" | "ADMOB" | "CUSTOM";
    platform: "WEB" | "IOS" | "ANDROID";
    enabled: boolean;
    configured: boolean;
    testMode: boolean;
    note?: string;
    reason?: string;
};

const NETWORK_META: Record<
    string,
    { label: string; env: string[]; steps: string[]; icon: React.ComponentType<{ size?: number; className?: string }> }
> = {
    ADSENSE: {
        label: "Google AdSense",
        env: ["NEXT_PUBLIC_ADSENSE_CLIENT_ID", "ADSENSE_ENABLED=true"],
        steps: [
            "Get an AdSense publisher (client) ID for your site.",
            "Set NEXT_PUBLIC_ADSENSE_CLIENT_ID and ADSENSE_ENABLED=true in the environment.",
            "Deploy/restart so the web layout picks it up, then refresh this page.",
        ],
        icon: Globe,
    },
    ADMOB: {
        label: "Google AdMob",
        env: ["ADMOB_APP_ID (mobile app env)"],
        steps: [
            "AdMob is a native mobile integration — it renders inside the iOS/Android apps.",
            "Set ADMOB_APP_ID in the mobile app's environment during app build.",
            "AdMob is never rendered in the Next.js web app — no web config exists for it.",
        ],
        icon: Smartphone,
    },
    CUSTOM: {
        label: "Custom ad network",
        env: ["CUSTOM_AD_ENDPOINT"],
        steps: [
            "Point the engine at your own ad endpoint.",
            "Set CUSTOM_AD_ENDPOINT in the server environment.",
            "Restart, then refresh this page.",
        ],
        icon: Terminal,
    },
};

export default function AdminAdNetworksPage() {
    const networks = useAdminFetch<NetworkStatus[]>("/api/growth/ad-networks");

    const grouped = (() => {
        const map = new Map<string, NetworkStatus[]>();
        for (const n of networks.data || []) {
            const list = map.get(n.type) || [];
            list.push(n);
            map.set(n.type, list);
        }
        return [...map.entries()];
    })();

    if (networks.loading) {
        return (
            <div className="space-y-4" role="status" aria-label="Loading ad networks">
                <Skeleton className="h-8 w-56" />
                <div className="grid gap-4 lg:grid-cols-3">
                    <Skeleton className="h-64" />
                    <Skeleton className="h-64" />
                    <Skeleton className="h-64" />
                </div>
            </div>
        );
    }

    if (networks.error) {
        return (
            <ErrorState
                title="Couldn't load ad networks"
                description={networks.error}
                action={<Button type="button" variant="outline" onClick={networks.refresh}>Retry</Button>}
            />
        );
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Ad networks"
                subtitle="Real configuration state of each ad network, read from the server environment."
                actions={<RefreshButton onRefresh={networks.refresh} loading={networks.loading} />}
            />

            {!networks.data || networks.data.length === 0 ? (
                <EmptyState icon={<Globe size={18} />} title="No ad networks registered" description="Network status is computed by the server from environment configuration." />
            ) : (
                <div className="grid gap-4 lg:grid-cols-3">
                    {grouped.map(([type, rows]) => {
                        const meta = NETWORK_META[type] || { label: type, env: [], steps: [], icon: Globe };
                        const Icon = meta.icon;
                        const anyConfigured = rows.some((r) => r.configured);
                        return (
                            <div key={type} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
                                <div className="flex items-start justify-between gap-2">
                                    <span className="flex items-center gap-2 font-medium text-foreground">
                                        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
                                            <Icon size={17} />
                                        </span>
                                        {meta.label}
                                    </span>
                                    <GrowthStatusBadge kind="network" value={anyConfigured ? "CONFIGURED" : "NOT_CONFIGURED"} />
                                </div>

                                <div className="flex flex-wrap gap-1.5">
                                    <Badge variant="outline" className="text-xs normal-case">{rows[0].platform === "WEB" ? "Web" : "Mobile"}{rows.length > 1 ? " · iOS + Android" : ""}</Badge>
                                    <Badge variant="outline" className="text-xs normal-case">
                                        <Zap size={10} /> Test mode: {rows[0].testMode ? "on" : "off"}
                                    </Badge>
                                </div>

                                {type === "ADMOB" && (
                                    <p className="rounded-md border border-info/30 bg-info/10 p-3 text-xs text-info-foreground">
                                        Mobile integration — AdMob renders natively in the iOS/Android apps only. It is never rendered in the web app,
                                        so no web preview or slot exists here.
                                    </p>
                                )}

                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-foreground">Required environment</p>
                                    <ul className="space-y-1">
                                        {meta.env.map((v) => (
                                            <li key={v} className="rounded border border-border bg-muted/40 px-2 py-1 font-mono text-xs text-foreground">
                                                {v}
                                            </li>
                                        ))}
                                    </ul>
                                </div>

                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-foreground">Status</p>
                                    {rows.map((r) => (
                                        <p key={r.platform} className="text-xs text-muted-foreground">
                                            <span className="font-medium text-foreground">{r.platform}</span>: {r.configured ? "Configured" : r.reason}
                                        </p>
                                    ))}
                                </div>

                                <div className="mt-auto space-y-1 border-t border-border/60 pt-3">
                                    <p className="text-xs font-medium text-foreground">Steps</p>
                                    <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                                        {meta.steps.map((s, i) => (
                                            <li key={i}>{s}</li>
                                        ))}
                                    </ol>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-2 text-sm font-medium text-foreground">No secrets, no fakes</h2>
                <p className="text-xs text-muted-foreground">
                    Only boolean configuration state is ever exposed — never API keys or publisher values. When an env value is missing the network
                    shows <b>NOT_CONFIGURED</b> and no ad slot renders for it.
                </p>
            </div>
        </div>
    );
}