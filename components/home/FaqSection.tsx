"use client";

import { Accordion } from "@base-ui/react/accordion";
import { Plus } from "@phosphor-icons/react";
import Reveal from "./Reveal";
import HomeAurora from "./HomeAurora";
import HomeSectionHeader from "./HomeSectionHeader";

const FAQS = [
    {
        q: "Is the performance data on this page real?",
        a: "Yes. Every figure is a stored simulation run recorded on the platform — initial balance, net result, win rate and max drawdown. When no run is recorded yet, the page shows a small labelled sample-preview set so it is never empty, and any preview is flagged as such. Nothing here is invented to decorate the page.",
    },
    {
        q: "Do I have to share my broker credentials?",
        a: "No. The gateway runs inside your own MetaTrader terminal: your credentials never leave it. The platform only receives validated orders to dispatch and heartbeats back, with a full audit trail of every position it opens.",
    },
    {
        q: "Which platforms and languages are supported?",
        a: "The workspace compiles one source of truth to Pine Script v6 and MQL5, bridges to MetaTrader 4 and 5, reads live quotes from provider-backed feeds, and pushes alerts to Telegram. Signal and execution modules share the same risk model.",
    },
    {
        q: "Can I start without paying?",
        a: "Yes — the free workspace includes a backtest studio, Monte Carlo stress-testing and the risk tooling. Paid plans add live execution, deeper analytics and marketplace licensing. No credit card is required to start.",
    },
    {
        q: "How is risk actually enforced?",
        a: "Every order passes pre-trade guards before dispatch: daily loss limits, position sizing, max drawdown, spread filters and session windows. If a guard trips, the order is blocked and the event is recorded — the guard list ships in the workflow section above.",
    },
    {
        q: "Can anyone verify a strategy I publish?",
        a: "Marketplace listings attach their recorded runs publicly — win rate, trades, rating and drawdown. Buyers see what was measured, and the published set is anonymous: no private accounts, no identities.",
    },
];

/**
 * 07 · FAQ — the honest-answer section.
 *
 * Base UI Accordion (keyboard and screen-reader native, single-open) on glass
 * panel surfaces. The open panel animates height off the library's
 * `--accordion-panel-height` variable; reduced-motion users get the same content
 * with the transition collapsed by the global motion guard.
 */
export default function FaqSection() {
    return (
        <section id="faq" className="home-section py-20 md:py-28">
            <HomeAurora
                className="opacity-40"
                aClassName="right-[12%] top-[-6rem] h-[24rem] w-[24rem]"
                bClassName="left-[-8%] bottom-[-6rem] h-[20rem] w-[20rem]"
            />
            <div className="page-container">
                <Reveal>
                    <HomeSectionHeader
                        eyebrow="07 · FAQ"
                        title="Straight answers, no fine-print dodge"
                        description="How the workspace records, enforces and shares the numbers it shows."
                    />
                </Reveal>

                <Reveal delay={70}>
                    <Accordion.Root defaultValue={[FAQS[0].q]} className="mx-auto mt-12 max-w-3xl">
                        {FAQS.map(({ q, a }) => (
                            <Accordion.Item
                                key={q}
                                value={q}
                                className="glass-panel mb-3 overflow-hidden last:mb-0"
                            >
                                <Accordion.Header>
                                    <Accordion.Trigger className="group flex w-full items-center justify-between gap-4 px-5 py-4 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background data-[panel-open]:bg-muted/20">
                                        <span className="text-sm font-semibold tracking-tight text-muted-foreground transition-colors duration-150 group-data-[panel-open]:text-foreground">
                                            {q}
                                        </span>
                                        <Plus
                                            size={16}
                                            weight="bold"
                                            aria-hidden
                                            className="shrink-0 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-data-[panel-open]:rotate-45 group-data-[panel-open]:text-primary"
                                        />
                                    </Accordion.Trigger>
                                </Accordion.Header>
                                <Accordion.Panel className="h-(--accordion-panel-height) overflow-hidden px-5 pb-5 text-sm leading-6 text-muted-foreground transition-[height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] data-[starting-style]:h-0 data-[ending-style]:h-0">
                                    {a}
                                </Accordion.Panel>
                            </Accordion.Item>
                        ))}
                    </Accordion.Root>
                </Reveal>
            </div>
        </section>
    );
}
