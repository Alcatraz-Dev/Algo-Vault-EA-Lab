import { useEffect } from "react";
import { PlacementType } from "@/lib/growth/constants";
import { checkCompliance } from "@/lib/growth/compliance";
import { RISK_DISCLOSURE_TEXT } from "@/lib/growth/constants";

export interface NativeAdCardProps {
    title: string;
    summary: string;
    url: string;
    placementKey?: PlacementType;
    premiumMode?: "SHOW" | "REDUCED" | "HIDE";
    content?: string;
}

export function NativeAdCard({ title, summary, url, placementKey, premiumMode, content }: NativeAdCardProps) {
    if (premiumMode === "HIDE") return null;

    useEffect(() => {
        // Report impression once per mount — idempotent via random event id
        try {
            const eventId = `av_imp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            fetch("/api/monetization/impression", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    placementKey,
                    clientEventId: eventId,
                }),
            }).catch(() => { /* best-effort */ });
        } catch { /* silent */ }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [placementKey]);

    const body = content || summary;
    const compliance = checkCompliance(body, { isAffiliateContent: false });

    return (
        <a
            href={url}
            className={`block rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50/60 to-teal-50/40 p-4 shadow-sm hover:shadow transition ${
                premiumMode === "REDUCED" ? "opacity-70" : ""
            }`}
        >
            <div className="flex items-center gap-2">
                <div className="text-[10px] uppercase tracking-wide text-emerald-700 font-medium">
                    {placementKey || "Native"}
                </div>
                {compliance.passed ? (
                    <div className="text-[10px] text-neutral-400">Sponsored</div>
                ) : (
                    <div className="text-[10px] text-red-600">Under review</div>
                )}
            </div>
            <h3 className="font-semibold text-sm mt-1">{title}</h3>
            <p className="text-xs text-neutral-600 mt-1">{summary}</p>
            {compliance.requiresRiskDisclosure && (
                <p className="text-[10px] text-neutral-400 mt-1">{RISK_DISCLOSURE_TEXT}</p>
            )}
        </a>
    );
}
