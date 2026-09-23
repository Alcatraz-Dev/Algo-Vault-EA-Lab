import { useEffect } from "react";

interface ExternalAdSlotProps {
    placementKey: string;
    provider?: "CUSTOM" | "ADSENSE";
    clientId?: string;
    slot?: string;
}

export function ExternalAdSlot({ placementKey, provider, clientId, slot }: ExternalAdSlotProps) {
    // Self-hide when not an AdSense placement or when not configured
    if (provider !== "ADSENSE") return null;

    const isConfigured =
        typeof clientId === "string" &&
        clientId.length > 0 &&
        (process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID ?? "") !== "" &&
        process.env.ADSENSE_ENABLED === "true";

    if (!isConfigured) return null;

    useEffect(() => {
        // Load AdSense script once globally if not already present
        const src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(clientId);
        const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
        if (!existing) {
            const s = document.createElement("script");
            s.async = true;
            s.crossOrigin = "anonymous";
            s.src = src;
            s.onload = () => {
                const win = window as Window & { adsbygoogle?: unknown[] };
                if (win.adsbygoogle && Array.isArray(win.adsbygoogle)) {
                    win.adsbygoogle.push({});
                }
            };
            document.head.appendChild(s);
        } else if (existing && (window as Window & { adsbygoogle?: unknown[] }).adsbygoogle) {
            (window as Window & { adsbygoogle?: unknown[] }).adsbygoogle?.push({});
        }
    }, [clientId]);

    return (
        <div className="w-full min-h-[90px] rounded-md border border-neutral-200 overflow-hidden bg-neutral-50">
            <ins
                className="adsbygoogle"
                style={{ display: "block", minHeight: "90px" }}
                data-ad-client={clientId}
                data-ad-slot={slot || placementKey}
                data-ad-format="auto"
                data-full-width-responsive="true"
            />
        </div>
    );
}