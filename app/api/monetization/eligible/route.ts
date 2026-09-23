import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { GROWTH_COLLECTIONS } from "@/lib/growth/constants";
import { MonetizationPlacement, MonetizationAd, MonetizationSettings } from "@/lib/growth/types";
import { resolveAdsForPlacement } from "@/lib/growth/placement";
import { getCapCounts, reserveCap } from "@/lib/growth/capstore";
import { isPremiumUser } from "@/lib/growth/subscription";
import { getActiveOffer } from "@/lib/growth/tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadPlacements(): Promise<MonetizationPlacement[]> {
    const snap = await adminDatabase.ref(GROWTH_COLLECTIONS.placements).get();
    if (!snap.exists()) return [];
    const data = snap.val() as Record<string, MonetizationPlacement>;
    return Object.entries(data).map(([id, val]) => ({ ...val, id }));
}

async function loadAds(): Promise<MonetizationAd[]> {
    const snap = await adminDatabase.ref(GROWTH_COLLECTIONS.ads).get();
    if (!snap.exists()) return [];
    const data = snap.val() as Record<string, MonetizationAd>;
    return Object.entries(data).map(([id, val]) => ({ ...val, id }));
}

async function loadSettings(): Promise<MonetizationSettings | null> {
    const snap = await adminDatabase.ref(GROWTH_COLLECTIONS.settings).get();
    if (!snap.exists()) return null;
    return snap.val() as MonetizationSettings;
}

async function verifyToken(header: string | null): Promise<{ uid: string; isPremium: boolean } | null> {
    if (!header?.startsWith("Bearer ")) return null;
    const token = header.slice(7);
    try {
        const decoded = await adminAuth.verifyIdToken(token);
        const uid = decoded.uid;
        const isPremium = await isPremiumUser(uid);
        return { uid, isPremium };
    } catch {
        return null;
    }
}

function ensureSidCookie(request: NextRequest): string {
    let sid = request.cookies.get("av_sid")?.value;
    if (!sid) {
        const bytes = new Uint8Array(18);
        crypto.getRandomValues(bytes);
        sid = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }
    return sid;
}

export async function GET(request: NextRequest) {
    try {
        const kind = request.nextUrl.searchParams.get("kind") ?? "ad";
        const [placementData, authState, settings] = await Promise.all([
            loadPlacements(),
            verifyToken(request.headers.get("authorization")),
            loadSettings(),
        ]);

        const settingsObj = settings ?? { enabled: false, premiumMode: "SHOW" as const, premiumReductionRatio: 0.5 };
        if (!settingsObj.enabled) {
            return NextResponse.json({ eligible: false, placementKey: "", items: [], frequency: { allowed: false, remaining: null }, visitorKey: "disabled" });
        }

        const placementKey = request.nextUrl.searchParams.get("placement") ?? "HOME_NATIVE";
        const foundPlacement = placementData.find((p) => p.key === placementKey);

        if (kind === "affiliate") {
            // Affiliate eligibility: placement must be active, targeted, cap-ok
            if (!foundPlacement || !foundPlacement.active) {
                return NextResponse.json({ eligible: false, placementKey, affiliate: null, frequency: { allowed: false, remaining: null }, visitorKey: "" });
            }
            const uid = authState?.uid ?? null;
            const sid = ensureSidCookie(request);
            const visitorKey = uid ?? sid;
            const ctx = { uid, isPremium: authState?.isPremium ?? false, loggedOut: !uid, salt: sid };
            const capCounts = await getCapCounts(visitorKey, placementKey);

            // Find active affiliate offer
            const offerSnap = await adminDatabase.ref(GROWTH_COLLECTIONS.affiliateOffers).get();
            let offer: { id: string; name: string; provider?: string; category: string; description?: string; disclosure: string; url: string; imageUrl?: string; active: boolean; status?: string } | null = null;
            if (offerSnap.exists()) {
                const data = offerSnap.val() as Record<string, any>;
                for (const [id, o] of Object.entries(data)) {
                    if (o?.active && (o?.status === "active" || !o.status)) {
                        offer = { id, ...o };
                        break;
                    }
                }
            }

            // Simple placement eligibility for affiliate context (cap + targeting)
            const isTargeted = foundPlacement && 
                (!foundPlacement.startAt || Date.now() >= foundPlacement.startAt) &&
                (!foundPlacement.endAt || Date.now() <= foundPlacement.endAt) &&
                (foundPlacement.active === true) &&
                (!foundPlacement.frequencyCap || (capCounts[foundPlacement.frequencyCap.type] ?? 0) < (foundPlacement.frequencyCap.limit ?? Infinity));

            if (!isTargeted || !offer) {
                return NextResponse.json({ eligible: false, placementKey, affiliate: null, frequency: { allowed: false, remaining: null }, visitorKey });
            }

            const cap = foundPlacement.frequencyCap;
            const remaining = cap?.limit ? Math.max(0, cap.limit - (capCounts[cap.type] ?? 0)) : null;

            const payload = {
                eligible: true,
                placementKey: foundPlacement.key,
                items: [],
                affiliate: {
                    placementKey: foundPlacement.key,
                    id: offer.id,
                    name: offer.name,
                    provider: offer.provider,
                    category: offer.category,
                    description: offer.description,
                    disclosure: offer.disclosure,
                    destinationUrl: offer.url,
                    imageUrl: offer.imageUrl,
                },
                frequency: { allowed: true, remaining },
                visitorKey,
            };
            const response = NextResponse.json(payload);
            if (!uid) response.cookies.set("av_sid", sid, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60 });
            return response;
        }

        // Standard placement eligibility (ad delivery)
        if (!foundPlacement || !foundPlacement.active) {
            return NextResponse.json({ eligible: false, placementKey, items: [], frequency: { allowed: false, remaining: null }, visitorKey: "" });
        }

        const uid = authState?.uid ?? null;
        const sid = ensureSidCookie(request);
        const visitorKey = uid ?? sid;
        const ctx = { uid, isPremium: authState?.isPremium ?? false, loggedOut: !uid, salt: sid };
        const capCounts = await getCapCounts(visitorKey, placementKey);
        const ads = await loadAds();

        const eligibleAds = resolveAdsForPlacement(
            foundPlacement,
            ads,
            ctx,
            { premiumMode: settingsObj.premiumMode, premiumRatio: settingsObj.premiumReductionRatio ?? 0.5 }
        );

        let reserved = true;
        if (eligibleAds.length > 0 && foundPlacement.frequencyCap) {
            reserved = await reserveCap(visitorKey, placementKey, [foundPlacement.frequencyCap]);
        }

        if (!reserved || eligibleAds.length === 0) {
            return NextResponse.json({ eligible: false, placementKey, items: [], frequency: { allowed: false, remaining: 0 }, visitorKey });
        }

        const finalCapCounts = await getCapCounts(visitorKey, placementKey);
        const cap = foundPlacement.frequencyCap;
        const remaining = cap?.limit ? Math.max(0, cap.limit - (finalCapCounts[cap.type] ?? 0)) : null;

        const items = eligibleAds.map((ad) => ({
            placementKey: foundPlacement.key,
            id: ad.id ?? "",
            type: ad.type === "SPONSORED_CARD" ? "sponsored_card" : ad.type === "BANNER" ? "banner" : "native_ad",
            provider: "CUSTOM" as const,
            creative: {
                title: ad.title,
                body: ad.body,
                imageUrl: ad.imageUrl,
                ctaLabel: ad.ctaLabel,
                advertiser: ad.advertiser,
                disclosure: ad.disclosure ?? "Sponsored",
                destinationUrl: ad.targetUrl,
                type: ad.type,
            },
            frequency: { allowed: true, remaining },
        }));

        const payload = {
            eligible: true,
            placementKey: foundPlacement.key,
            items,
            frequency: { allowed: true, remaining },
            visitorKey,
        };

        const response = NextResponse.json(payload);
        if (!uid) response.cookies.set("av_sid", sid, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60 });
        return response;
    } catch (err) {
        console.error("[GET /api/monetization/eligible]", err);
        return NextResponse.json({ eligible: false, placementKey: "", items: [], frequency: { allowed: false, remaining: null }, visitorKey: "" });
    }
}

export async function POST() {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}