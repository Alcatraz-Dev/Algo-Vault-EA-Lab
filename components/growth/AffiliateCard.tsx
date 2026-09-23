import { AffiliateOffer } from "@/lib/growth/types";
import { PlacementType } from "@/lib/growth/constants";
import { appendAttribution } from "@/lib/growth/attribution";
import { checkCompliance } from "@/lib/growth/compliance";
import { RISK_DISCLOSURE_TEXT } from "@/lib/growth/constants";

export interface AffiliateCardProps {
    offer: AffiliateOffer;
    placementKey?: PlacementType;
    premiumMode?: "SHOW" | "REDUCED" | "HIDE";
    onTrackClick?: (offerId: string) => void;
}

export function AffiliateCard({ offer, placementKey, premiumMode, onTrackClick }: AffiliateCardProps) {
    if (premiumMode === "HIDE") return null;

    const compliance = checkCompliance(offer.description || offer.name, {
        affiliateType: "OFFER",
        isAffiliateContent: true,
    });

    const trackedUrl = appendAttribution(offer.url, {
        offerId: offer.id,
        placementKey,
        source: "affiliate",
        medium: "affiliate",
    });

    return (
        <a
            href={trackedUrl}
            target="_blank"
            rel="sponsor noopener noreferrer"
            onClick={() => onTrackClick?.(offer.id || "")}
            className={`block rounded-xl border border-emerald-100/60 bg-gradient-to-br from-emerald-50/40 to-teal-50/30 p-4 shadow-sm hover:shadow transition ${
                premiumMode === "REDUCED" ? "opacity-70" : ""
            }`}
        >
            <div className="flex items-center gap-2">
                <div className="text-[10px] uppercase tracking-wide text-emerald-700 font-medium">Affiliate</div>
                {offer.category && (
                    <span className="text-[10px] text-neutral-400">{offer.category}</span>
                )}
            </div>
            <h4 className="font-semibold text-sm mt-1">{offer.name}</h4>
            {offer.description && (
                <p className="text-xs text-neutral-600 mt-1 line-clamp-2">{offer.description}</p>
            )}
            {offer.provider && (
                <p className="text-[10px] text-neutral-400 mt-1">Via {offer.provider}</p>
            )}
            {!compliance.passed && compliance.flags.some((f) => f.severity === "high") && (
                <p className="text-[10px] text-red-600 mt-1">Content under compliance review</p>
            )}
            <div className="text-[10px] text-neutral-400 mt-1">
                {offer.disclosure || `We may earn a commission if you purchase through affiliate links${offer.provider ? ` from ${offer.provider}` : ""} — at no extra cost to you.`}
            </div>
            <div className="text-[10px] text-neutral-400 mt-1">
                {RISK_DISCLOSURE_TEXT}
            </div>
        </a>
    );
}
