"use client";

import { useEffect, useState } from "react";
import { database } from "@/lib/firebase";
import { onValue, ref } from "firebase/database";
import type { HomeData } from "@/lib/home-data";
import SiteHeader from "./site-header";
import SiteFooter from "@/components/footer/SiteFooter";
import TickerStrip from "./TickerStrip";
import AceternityHero from "./AceternityHero";
import LoopTabs from "./LoopTabs";
import WireUpSection from "./WireUpSection";
import NetworkSection from "./NetworkSection";
import CodeSection from "./CodeSection";
import CatalogSection from "./CatalogSection";
import PricingTeaser from "./PricingTeaser";
import CtaHighlight from "./CtaHighlight";
import DesktopDownloadSection from "./DesktopDownloadSection";

/**
 * Homepage composition (Kestrel rhythm, AlgoVault content).
 *
 * Hero with logo cloud → tabbed loop → interactive wiring graph →
 * coverage stats → code window → strategy catalog → pricing teaser →
 * closing CTA. Every figure comes from `getHomeData`; every sample is
 * labeled; every link targets an existing route.
 */
export default function HomePage({ data, dataNotice }: { data: HomeData; dataNotice?: string | null }) {
    const [siteName, setSiteName] = useState("AlgoVault");

    useEffect(() => {
        const unsubscribe = onValue(ref(database, "settings/siteName"), (snapshot) => {
            const value = snapshot.val();
            if (typeof value === "string" && value.trim()) setSiteName(value.trim());
        });
        return () => unsubscribe();
    }, []);

    return (
        <div data-home-page="" className="min-h-screen overflow-x-clip bg-background font-sans text-foreground selection:bg-primary selection:text-primary-foreground">
            <SiteHeader />
            {dataNotice ? (
                <div data-home-data-notice="" role="status" className="border-b border-border bg-card/80">
                    <p className="mx-auto max-w-7xl px-6 py-2.5 text-center text-xs text-muted-foreground">{dataNotice}</p>
                </div>
            ) : null}
            <main>
                <TickerStrip />
                <AceternityHero data={data} siteName={siteName} />
                <LoopTabs data={data} />
                <WireUpSection />
                <NetworkSection data={data} />
                <CodeSection data={data} />
                <CatalogSection featured={data.featured} />
                <DesktopDownloadSection />
                <PricingTeaser />
                <CtaHighlight />
            </main>
            <SiteFooter />
        </div>
    );
}
