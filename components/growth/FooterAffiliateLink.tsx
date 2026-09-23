"use client";

import { useState, useEffect, useCallback } from "react";
import { auth } from "@/lib/firebase";
import { AffiliateCard } from "@/components/growth/AffiliateCard";

export function FooterAffiliateLink() {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            let headers: Record<string, string> = {};
            try {
                const user = auth.currentUser;
                if (user) {
                    const token = await user.getIdToken(true);
                    headers.Authorization = `Bearer ${token}`;
                }
            } catch { /* ignore token errors */ }

            const res = await fetch("/api/monetization/eligible?placement=FOOTER&kind=affiliate", {
                headers,
                credentials: "include",
                cache: "no-store",
            });
            if (res.ok) {
                const json = await res.json();
                setData(json);
            } else {
                setData(null);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
            setData(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    // Self-hide: no eligible affiliate = nothing rendered
    if (loading || error || !data || !data.eligible || !data.affiliate) return null;

    const offer = data.affiliate;
    return (
        <div className="py-4">
            <AffiliateCard
                offer={{
                    id: offer.id,
                    name: offer.name,
                    provider: offer.provider,
                    category: offer.category,
                    description: offer.description,
                    url: offer.destinationUrl,
                    disclosure: offer.disclosure,
                    active: true,
                    status: "active",
                    commissionModel: "PERCENTAGE",
                    commissionAmount: 0,
                    placement: "FOOTER",
                    campaignId: undefined,
                } as any}
                placementKey="FOOTER"
            />
        </div>
    );
}