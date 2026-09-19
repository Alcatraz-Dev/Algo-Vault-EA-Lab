"use client";

import { Send, Cpu, Brain, ShieldAlert, ArrowRight, CheckCircle2, Lock } from "lucide-react";

export default function TelegramPipelineSection() {
    return (
        <section className="py-20 border-b border-border/40 bg-card/20 relative overflow-hidden">
            <div className="mx-auto max-w-7xl px-6 md:px-8">
                
                {/* Section Header */}
                <div className="mx-auto max-w-3xl text-center">
                    <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">Signal Intelligence</p>
                    <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
                        Telegram Signal Ingestion & AI Normalization
                    </h2>
                    <p className="mt-3 text-base text-muted-foreground">
                        Connect private Telegram signal channels via native MTProto API, automatically parse complex signal syntax with AI, and pass signals to the risk engine.
                    </p>
                </div>

                {/* Visual Pipeline Flow */}
                <div className="mt-12 rounded-3xl border border-border/80 bg-card/80 p-6 md:p-8 shadow-2xl backdrop-blur-xl space-y-8">
                    
                    {/* Pipeline Nodes Flow */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 font-mono text-center text-xs">
                        {[
                            { name: "Telegram", desc: "Private Channels", color: "text-sky-400" },
                            { name: "MTProto", desc: "Native GramJS", color: "text-sky-400" },
                            { name: "Fast Parser", desc: "Regex Engine", color: "text-amber-400" },
                            { name: "AI Parser", desc: "LLM Normalizer", color: "text-violet-400" },
                            { name: "Signal Engine", desc: "State Machine", color: "text-emerald-400" },
                            { name: "Risk Engine", desc: "Limit Check", color: "text-rose-400" },
                            { name: "AlgoVault", desc: "Central Hub", color: "text-violet-300" },
                            { name: "MT5 Gateway", desc: "EA Execution", color: "text-emerald-400" },
                        ].map((node, i) => (
                            <div key={node.name} className="flex flex-col items-center rounded-xl bg-background/80 p-3 border border-border/40">
                                <span className="text-[10px] text-muted-foreground font-bold">STEP {i + 1}</span>
                                <span className={`font-bold mt-1 ${node.color}`}>{node.name}</span>
                                <span className="text-[10px] text-muted-foreground mt-0.5">{node.desc}</span>
                            </div>
                        ))}
                    </div>

                    {/* Example Raw vs Parsed Signal Demo Card */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                        <div className="lg:col-span-6 rounded-2xl border border-border/60 bg-background/90 p-5 font-mono text-xs space-y-3">
                            <div className="flex items-center justify-between text-muted-foreground border-b border-border/40 pb-2">
                                <span className="flex items-center gap-1.5 font-bold text-foreground"><Send size={14} className="text-sky-400" /> Incoming Telegram Text Message</span>
                                <span className="text-[10px] text-sky-400 font-bold">CHANNEL #492</span>
                            </div>
                            <div className="p-3 rounded-lg bg-muted/40 text-muted-foreground leading-relaxed text-[11px]">
                                "🔥 GOLD BUY NOW @ 2650-2652 !! SL 2642 TP1 2660 TP2 2665 TP3 2675. Manage risk carefully guys!"
                            </div>
                        </div>

                        <div className="lg:col-span-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 font-mono text-xs space-y-3">
                            <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2">
                                <span className="flex items-center gap-1.5 font-bold text-emerald-400"><Brain size={14} /> Normalized Signal Output</span>
                                <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-bold">READY FOR RISK</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                                <div>Symbol: <strong className="text-foreground">XAUUSD</strong></div>
                                <div>Direction: <strong className="text-emerald-400">BUY MARKET</strong></div>
                                <div>Entry Min: <strong className="text-foreground">2,650.00</strong></div>
                                <div>Entry Max: <strong className="text-foreground">2,652.00</strong></div>
                                <div>Stop Loss: <strong className="text-rose-400">2,642.00</strong></div>
                                <div>TP Targets: <strong className="text-emerald-400">2660 / 2665 / 2675</strong></div>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-xl bg-background/60 p-3 border border-border/40 flex items-center justify-between text-xs font-mono text-muted-foreground">
                        <span className="flex items-center gap-1.5"><Lock size={13} className="text-violet-400" /> Telegram Channel Management & MTProto Session storage is strictly ADMIN-ONLY.</span>
                        <span className="text-emerald-400 font-bold">RBAC Enforced</span>
                    </div>

                </div>

            </div>
        </section>
    );
}
