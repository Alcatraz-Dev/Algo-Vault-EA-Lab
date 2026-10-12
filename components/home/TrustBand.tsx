"use client";

import { Cube, Eye, Key, ShieldCheck } from "@phosphor-icons/react";
import Reveal from "./Reveal";
import TacticalCard from "./TacticalCard";
import HomeAurora from "./HomeAurora";
import HomeSectionHeader from "./HomeSectionHeader";
import { IconTile } from "@/components/reui/icon-tile";

const TRUST_PILLARS = [
    {
        icon: Cube,
        title: "Deterministic engine",
        copy: "Same candles in, same result out. Every simulation is single-pass and reproducible run to run.",
    },
    {
        icon: Eye,
        title: "Honest data states",
        copy: "Stale or disconnected feeds are labelled as such, never dressed up as live.",
    },
    {
        icon: ShieldCheck,
        title: "Risk gates before dispatch",
        copy: "Daily loss limits, position sizing and drawdown guards run on every order before it can leave.",
    },
    {
        icon: Key,
        title: "Your broker, your keys",
        copy: "Credentials stay inside your own MT5 terminal; the gateway only streams validated orders and heartbeats.",
    },
];

/**
 * 06 · Trust — four properties that hold for every module on the page.
 *
 * Glass tiles: each claim is a behaviour of the platform (deterministic
 * simulator, labelled data states, pre-dispatch guards, own-terminal gateway),
 * not a licensing promise or an invented metric — so the tiles carry words, not
 * numbers (DESIGN.md §17).
 */
export default function TrustBand() {
    return (
        <section id="trust" className="home-section py-20 md:py-28">
            <HomeAurora
                className="opacity-50"
                aClassName="left-[10%] top-[-6rem] h-[22rem] w-[22rem]"
                bClassName="right-[-6%] bottom-[-8rem] h-[24rem] w-[24rem]"
            />
            <div className="page-container">
                <Reveal>
                    <HomeSectionHeader
                        eyebrow="06 · Trust"
                        title="Built the way records should be kept"
                        description="Four properties that hold for every module on this page — no licence tier required."
                    />
                </Reveal>

                <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {TRUST_PILLARS.map(({ icon: Icon, title, copy }, i) => {
                        const dir: -1 | 1 | 0 = i % 2 === 0 ? -1 : 1;
                        return (
                            <TacticalCard
                                key={title}
                                dir={dir}
                                delay={Math.min(i, 3) * 70}
                                spotlight={true}
                                className="h-full"
                            >
                                <div className="glass-panel glass-panel--lift flex h-full flex-col gap-3 p-6 transition-colors duration-200 hover:border-primary/50">
                                    <IconTile variant="soft" size="lg" radius="full" aria-hidden>
                                        <Icon weight="bold" />
                                    </IconTile>
                                    <h3 className="mt-1 font-semibold tracking-tight text-foreground">
                                        {title}
                                    </h3>
                                    <p className="text-sm leading-6 text-muted-foreground">{copy}</p>
                                </div>
                            </TacticalCard>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
