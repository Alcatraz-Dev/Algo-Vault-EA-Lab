"use client";

import Link from "next/link";
import { ArrowRight, ShoppingBag, Star, Download, ShieldCheck } from "lucide-react";
import type { HomeProduct } from "@/lib/home-data";

export default function MarketplaceSection({ featured = [] }: { featured: HomeProduct[] }) {
    return (
        <section className="py-20 border-b border-border/40 bg-background relative overflow-hidden">
            <div className="mx-auto max-w-7xl px-6 md:px-8">
                
                {/* Section Header */}
                <div className="flex flex-col md:flex-row md:items-end md:justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">Trading Marketplace</p>
                        <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
                            Verified EAs, Indicators & Set Files
                        </h2>
                        <p className="mt-3 text-base text-muted-foreground max-w-2xl">
                            Deploy tested MetaTrader Expert Advisors and custom configuration set files with automatic license key activation.
                        </p>
                    </div>
                    <Link
                        href="/marketplace"
                        className="mt-4 md:mt-0 inline-flex items-center gap-1.5 text-xs font-bold text-violet-400 hover:text-violet-300 transition"
                    >
                        Explore All Marketplace Items <ArrowRight size={14} />
                    </Link>
                </div>

                {/* Product Grid */}
                <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {featured.length > 0 ? (
                        featured.map((product) => (
                            <Link
                                key={product.id}
                                href={`/marketplace/${product.slug || product.id}`}
                                className="group rounded-2xl border border-border/60 bg-card/80 p-6 shadow-sm transition hover:border-violet-500/50 hover:shadow-xl flex flex-col justify-between"
                            >
                                <div>
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <h3 className="font-bold text-foreground group-hover:text-violet-400 transition text-base">
                                                {product.name}
                                            </h3>
                                            <p className="mt-1 text-xs text-muted-foreground font-mono">
                                                {product.symbol || "Multi-Symbol"} · {product.timeframe || "M15"}
                                            </p>
                                        </div>
                                        {product.pricing?.price !== undefined && (
                                            <span className="rounded-xl bg-violet-500/10 px-3 py-1 text-xs font-extrabold text-violet-300 border border-violet-500/20 font-mono">
                                                ${product.pricing.price}
                                            </span>
                                        )}
                                    </div>

                                    {product.performance && (
                                        <div className="mt-5 grid grid-cols-3 gap-2 rounded-xl bg-background/80 p-3 text-center font-mono border border-border/40">
                                            <div>
                                                <p className="text-[10px] text-muted-foreground">Return</p>
                                                <p className="text-xs font-bold text-emerald-400">{product.performance.profit ? `+${product.performance.profit}%` : "—"}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-muted-foreground">Win Rate</p>
                                                <p className="text-xs font-bold text-foreground">{product.performance.winRate ? `${product.performance.winRate}%` : "—"}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-muted-foreground">Trades</p>
                                                <p className="text-xs font-bold text-muted-foreground">{product.performance.totalTrades || "—"}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="mt-5 pt-3 border-t border-border/40 flex items-center justify-between text-xs font-mono text-muted-foreground">
                                    <span className="flex items-center gap-1 text-emerald-400 font-bold"><ShieldCheck size={13} /> License Protected</span>
                                    <span className="group-hover:translate-x-1 transition text-violet-400 font-bold flex items-center gap-1">View Details <ArrowRight size={13} /></span>
                                </div>
                            </Link>
                        ))
                    ) : (
                        /* Fallback Demo Cards */
                        [
                            { title: "Gold SMC Scalper EA", symbol: "XAUUSD M15", price: "$149", return: "+148.5%", win: "68.2%" },
                            { title: "Crypto Momentum EA", symbol: "BTCUSD H1", price: "$199", return: "+210.0%", win: "64.0%" },
                            { title: "FX Multi-Pair Trend EA", symbol: "EURUSD / GBPUSD H4", price: "$129", return: "+92.4%", win: "71.5%" },
                        ].map((item) => (
                            <Link
                                key={item.title}
                                href="/marketplace"
                                className="group rounded-2xl border border-border/60 bg-card/80 p-6 shadow-sm transition hover:border-violet-500/50 hover:shadow-xl flex flex-col justify-between"
                            >
                                <div>
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <h3 className="font-bold text-foreground group-hover:text-violet-400 transition text-base">
                                                {item.title}
                                            </h3>
                                            <p className="mt-1 text-xs text-muted-foreground font-mono">{item.symbol}</p>
                                        </div>
                                        <span className="rounded-xl bg-violet-500/10 px-3 py-1 text-xs font-extrabold text-violet-300 border border-violet-500/20 font-mono">
                                            {item.price}
                                        </span>
                                    </div>
                                    <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl bg-background/80 p-3 text-center font-mono border border-border/40">
                                        <div>
                                            <p className="text-[10px] text-muted-foreground">Historical Return</p>
                                            <p className="text-xs font-bold text-emerald-400">{item.return}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] text-muted-foreground">Win Rate</p>
                                            <p className="text-xs font-bold text-foreground">{item.win}</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-5 pt-3 border-t border-border/40 flex items-center justify-between text-xs font-mono text-muted-foreground">
                                    <span className="flex items-center gap-1 text-emerald-400 font-bold"><ShieldCheck size={13} /> License Key Required</span>
                                    <span className="group-hover:translate-x-1 transition text-violet-400 font-bold flex items-center gap-1">Explore <ArrowRight size={13} /></span>
                                </div>
                            </Link>
                        ))
                    )}
                </div>

            </div>
        </section>
    );
}
