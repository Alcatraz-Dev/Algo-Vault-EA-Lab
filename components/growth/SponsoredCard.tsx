import { PlacementType, RISK_DISCLOSURE_TEXT } from "@/lib/growth/constants";
import { checkCompliance } from "@/lib/growth/compliance";

export interface SponsoredCardProps {
    title: string;
    description?: string;
    imageUrl?: string;
    targetUrl: string;
    advertiser?: string;
    disclosure?: string;
    placementKey?: PlacementType;
    premiumMode?: "SHOW" | "REDUCED" | "HIDE";
}

export function SponsoredCard(props: SponsoredCardProps) {
    if (props.premiumMode === "HIDE") return null;

    const compliance = checkCompliance(props.title + " " + (props.description || ""), { isAffiliateContent: false });

    return (
        <a
            href={props.targetUrl}
            rel="sponsor"
            className={`block rounded-xl border border-amber-200/40 bg-gradient-to-br from-amber-50/80 to-orange-50/60 p-4 shadow-sm hover:shadow transition ${
                props.premiumMode === "REDUCED" ? "opacity-70" : ""
            }`}
        >
            <div className="flex items-center gap-2">
                <div className="text-xs uppercase tracking-wide text-amber-700 font-medium">
                    {props.placementKey || "Sponsored"}
                </div>
                {!compliance.passed && compliance.flags.some((f) => f.severity === "high") && (
                    <div className="text-[10px] text-red-600">Under review</div>
                )}
            </div>
            {props.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={props.imageUrl} alt={props.title} className="mb-2 h-20 w-full object-cover rounded-lg" />
            )}
            <h4 className="font-semibold text-sm leading-tight">{props.title}</h4>
            {props.description && <p className="text-xs text-neutral-600 mt-1">{props.description}</p>}
            {props.advertiser && <div className="text-[10px] text-neutral-400 mt-2">By {props.advertiser}</div>}
            {props.disclosure && <div className="text-[10px] text-amber-600 mt-1">{props.disclosure}</div>}
            <div className="text-[10px] text-neutral-400 mt-1">{RISK_DISCLOSURE_TEXT}</div>
        </a>
    );
}
