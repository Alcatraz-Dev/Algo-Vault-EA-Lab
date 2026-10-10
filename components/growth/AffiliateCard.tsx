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
            className={`block rounded-lg border border-positive/60 bg-positive-muted p-4 shadow-sm hover:shadow transition ${
                premiumMode === "REDUCED" ? "opacity-70" : ""
            }`}
        >
            <div className="flex items-center gap-2">
                <div className="text-micro uppercase tracking-wide text-positive font-medium">Affiliate</div>
                {offer.category && (
                    <span className="text-micro text-muted-foreground">{offer.category}</span>
                )}
            </div>
            <h4 className="font-semibold text-sm mt-1">{offer.name}</h4>
            {offer.description && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{offer.description}</p>
            )}
            {offer.provider && (
                <p className="text-micro text-muted-foreground mt-1">Via {offer.provider}</p>
            )}
            {!compliance.passed && compliance.flags.some((f) => f.severity === "high") && (
                <p className="text-micro text-negative mt-1">Content under compliance review</p>
            )}
            <div className="text-micro text-muted-foreground mt-1">
                {offer.disclosure || `We may earn a commission if you purchase through affiliate links${offer.provider ? ` from ${offer.provider}` : ""} — at no extra cost to you.`}
            </div>
            <div className="text-micro text-muted-foreground mt-1">
                {RISK_DISCLOSURE_TEXT}
            </div>
        </a>
    );
}
