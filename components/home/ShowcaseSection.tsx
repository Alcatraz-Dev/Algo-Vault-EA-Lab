"use client";

import Link from "next/link";
import { ArrowRight, ShieldCheck, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { HomeProduct } from "@/lib/home-data";
import CountUp from "./CountUp";
import Reveal from "./Reveal";
import TacticalCard from "./TacticalCard";
import HomeAurora from "./HomeAurora";
import HomeSectionHeader from "./HomeSectionHeader";
import WinRateBarChart from "./charts/WinRateBarChart";

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function priceLabel(p?: HomeProduct["pricing"]): string {
  if (!p || p.price === undefined) return "See pricing";
  const cur = p.currency === "USD" || !p.currency ? "$" : `${p.currency} `;
  return `${cur}${new Intl.NumberFormat("en-US").format(p.price)}`;
}

/**
 * Marketplace preview — premium SaaS proof band.
 * Real featured products only. Empty state when nothing is listed;
 * never falls back to invented demo cards.
 */
export default function ShowcaseSection({
  featured,
  strategies,
  backtests,
}: {
  featured: HomeProduct[];
  strategies: number;
  backtests: number;
}) {
  const items = featured.slice(0, 3);
  const perfRows = featured
    .map((p) => ({ name: p.name, winRate: Number(p.performance?.winRate) }))
    .filter((row) => Number.isFinite(row.winRate) && row.winRate > 0);

  return (
    <section id="solutions" className="home-section py-20 md:py-28">
      <HomeAurora
        className="opacity-50"
        aClassName="right-[6%] top-[-6rem] h-[24rem] w-[24rem]"
        bClassName="left-[-8%] bottom-[-10rem] h-[26rem] w-[26rem]"
      />
      <div className="page-container">
        <Reveal>
          <HomeSectionHeader
            align="left"
            eyebrow="05 · Marketplace"
            title="Ship strategies others can verify"
            description="Licensed EAs, indicators and set files with recorded runs attached. What you see is what was measured."
          />
        </Reveal>

        {items.length > 0 ? (
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {items.map((product, i) => {
              const dir: -1 | 1 | 0 = i === 0 ? -1 : i === 2 ? 1 : 0;
              return (
                <TacticalCard
                  key={product.id}
                  dir={dir}
                  delay={i * 70}
                  spotlight={true}
                  className="h-full"
                >
                  <Link
                    href={`/marketplace/${product.slug || product.id}`}
                    className="group block h-full"
                    aria-label={`Open ${product.name} in the marketplace`}
                  >
                    <Card className="h-full transition-colors duration-200 hover:border-primary/40">
                      <CardHeader>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-numeric text-xs tabular-nums text-muted-foreground">
                              {(product.symbol || "Multi-symbol") + (product.timeframe ? ` · ${product.timeframe}` : "")}
                            </p>
                            <p className="mt-1 truncate text-[15px] font-semibold tracking-tight text-foreground transition-colors group-hover:text-primary">
                              {product.name}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-md border border-primary/25 bg-primary/10 px-2.5 py-1 font-numeric text-xs font-semibold tabular-nums text-primary">
                            {priceLabel(product.pricing)}
                          </span>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <dl className="grid grid-cols-3 gap-2 rounded-lg border border-border/60 bg-background/60 p-3 text-center">
                          <div>
                            <dt className="text-xs text-muted-foreground">Win rate</dt>
                            <dd className="mt-0.5 font-numeric text-sm font-semibold tabular-nums text-foreground">
                              {product.performance?.winRate !== undefined ? `${product.performance.winRate}%` : "—"}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted-foreground">Trades</dt>
                            <dd className="mt-0.5 font-numeric text-sm font-semibold tabular-nums text-muted-foreground">
                              {product.performance?.totalTrades ?? "—"}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted-foreground">Rating</dt>
                            <dd className="mt-0.5 flex items-center justify-center gap-1 font-numeric text-sm font-semibold tabular-nums text-foreground">
                              <Star size={11} className="fill-primary text-primary" aria-hidden />
                              {product.rating?.average ?? "—"}
                            </dd>
                          </div>
                        </dl>
                        {product.description ? (
                          <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">{product.description}</p>
                        ) : null}
                      </CardContent>
                      <CardFooter className="flex items-center justify-between border-border/60 text-xs">
                        <span className="inline-flex items-center gap-1.5 font-medium text-positive">
                          <ShieldCheck size={13} aria-hidden /> License protected
                        </span>
                        <span className="inline-flex items-center gap-1 font-medium text-primary">
                          View details
                          <ArrowRight size={13} className="transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
                        </span>
                      </CardFooter>
                    </Card>
                  </Link>
                </TacticalCard>
              );
            })}
          </div>
        ) : (
          <Reveal delay={80}>
            <div className="mx-auto mt-10 max-w-xl">
              <EmptyState
                title="No strategies listed yet"
                description="Published strategies appear here with their recorded runs. Be the first to list one."
                action={<Button render={<Link href="/marketplace" />} variant="outline" size="sm">Open marketplace</Button>}
              />
            </div>
          </Reveal>
        )}

        {/* Metric band — real aggregates, SaaS strip */}
        <Reveal delay={120}>
          <dl className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border shadow-sm sm:grid-cols-3">
            {[
              { label: "Strategies listed", value: strategies, format: formatNumber },
              { label: "Recorded runs", value: backtests, format: formatNumber },
              { label: "Featured listings", value: featured.length, format: formatNumber },
            ].map((s) => (
              <div key={s.label} className="bg-card px-5 py-5 text-center">
                <dd className="font-numeric text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                  <CountUp value={s.value} format={s.format} />
                </dd>
                <dt className="mt-1 text-xs text-muted-foreground">{s.label}</dt>
              </div>
            ))}
          </dl>
        </Reveal>

        {perfRows.length > 0 ? (
          <Reveal delay={150}>
            <div className="mt-10">
              <WinRateBarChart data={perfRows} />
            </div>
          </Reveal>
        ) : null}

        <div className="mt-6 text-center">
          <Button render={<Link href="/marketplace" />} variant="outline">
            Browse the marketplace <ArrowRight data-icon="inline-end" size={15} />
          </Button>
        </div>
      </div>
    </section>
  );
}
