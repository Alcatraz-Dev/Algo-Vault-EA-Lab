"use client";

import { useEffect, useState } from "react";
import { database } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";
import type { HomeData } from "@/lib/home-data";
import SiteHeader from "@/components/home/site-header";
import SiteFooter from "@/components/footer/SiteFooter";

import HeroSection from "./HeroSection";
import IntelligenceBar from "./IntelligenceBar";
import LifecycleSection from "./LifecycleSection";
import StrategyIntelligenceSection from "./StrategyIntelligenceSection";
import MarketScannerSection from "./MarketScannerSection";
import BacktestingSection from "./BacktestingSection";
import AIOptimizationSection from "./AIOptimizationSection";
import PineWorkspaceSection from "./PineWorkspaceSection";
import ReplaySection from "./ReplaySection";
import TelegramPipelineSection from "./TelegramPipelineSection";
import RiskEngineSection from "./RiskEngineSection";
import GatewaySection from "./GatewaySection";
import LiveMonitoringSection from "./LiveMonitoringSection";
import CopilotSection from "./CopilotSection";
import MarketplaceSection from "./MarketplaceSection";
import CopyTradingSection from "./CopyTradingSection";
import FinalCTASection from "./FinalCTASection";

export default function HomePage({ data }: { data: HomeData }) {
    const [siteName, setSiteName] = useState("AlgoVault");

    useEffect(() => {
        const settingsRef = ref(database, "settings/siteName");
        const unsub = onValue(settingsRef, (snap) => {
            const val = snap.val();
            if (val && typeof val === "string") setSiteName(val);
        });
        return () => unsub();
    }, []);

    const { stats, featured } = data;

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-violet-500 selection:text-white">
            <SiteHeader />

            {/* 1. HERO SECTION */}
            <HeroSection siteName={siteName} stats={stats} />

            {/* 2. LIVE INTELLIGENCE BAR */}
            <IntelligenceBar />

            {/* 3. LIFECYCLE STORYTELLING */}
            <LifecycleSection />

            {/* 4. STRATEGY INTELLIGENCE */}
            <StrategyIntelligenceSection />

            {/* 5. MARKET SCANNER */}
            <MarketScannerSection />

            {/* 6. BACKTESTING ENGINE */}
            <BacktestingSection />

            {/* 7. AI OPTIMIZATION */}
            <AIOptimizationSection />

            {/* 8. PINE WORKSPACE */}
            <PineWorkspaceSection />

            {/* 9. MARKET REPLAY */}
            <ReplaySection />

            {/* 10. TELEGRAM SIGNAL PIPELINE */}
            <TelegramPipelineSection />

            {/* 11. RISK ENGINE */}
            <RiskEngineSection />

            {/* 12. GATEWAY EXECUTION */}
            <GatewaySection />

            {/* 13. LIVE MONITORING */}
            <LiveMonitoringSection />

            {/* 14. AI COPILOT */}
            <CopilotSection />

            {/* 15. MARKETPLACE */}
            <MarketplaceSection featured={featured} />

            {/* 16. COPY TRADING */}
            <CopyTradingSection />

            {/* 17. FINAL CTA */}
            <FinalCTASection siteName={siteName} />

            <SiteFooter />
        </div>
    );
}
