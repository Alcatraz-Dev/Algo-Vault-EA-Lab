"use client";

import BrandLogo, { type BrandLogoName } from "./BrandLogos";
import Reveal from "./Reveal";

const ROW: { name: BrandLogoName; label: string }[] = [
    { name: "tradingview", label: "TradingView" },
    { name: "mt5", label: "MetaTrader 5" },
    { name: "mt4", label: "MetaTrader 4" },
    { name: "pine", label: "Pine Script v6" },
    { name: "mql5", label: "MQL5" },
    { name: "telegram", label: "Telegram" },
];

/**
 * Integrations — the trust row under the hero.
 *
 * Real product marks (not fabricated logos) in a quiet wordmark cloud. The band
 * is transparent so the orb scene reads through it as the hero's scrim releases.
 */
export default function SocialProofBar() {
    return (
        <section aria-label="Integrations" className="home-section pb-14 pt-2 md:pb-16">
            <div className="page-container">
                <Reveal>
                    <p className="text-center text-micro font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Plugs into the stack you already trade on
                    </p>
                    <ul className="mx-auto mt-6 flex max-w-4xl flex-wrap items-center justify-center gap-x-8 gap-y-4">
                        {ROW.map(({ name, label }) => (
                            <li
                                key={name}
                                className="flex items-center gap-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
                                title={label}
                            >
                                <BrandLogo name={name} size={26} className="opacity-90" />
                                <span className="tracking-tight">{label}</span>
                            </li>
                        ))}
                    </ul>
                </Reveal>
            </div>
        </section>
    );
}