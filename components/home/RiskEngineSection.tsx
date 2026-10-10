"use client";

import { ShieldAlert, Lock, CheckCircle2, AlertOctagon, Sliders } from "lucide-react";

export default function RiskEngineSection() {
 return (
 <section className="py-20 border-b border-border/40 bg-background relative overflow-hidden">
 <div className="mx-auto max-w-7xl px-6 md:px-8">

 {/* Section Header */}
 <div className="mx-auto max-w-3xl text-center">
 <p className="text-xs font-semibold uppercase tracking-widest text-primary">Capital Protection</p>
 <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
 Pre-Execution Risk Engine & Rules
 </h2>
 <p className="mt-3 text-base text-muted-foreground">
 AlgoVault does not simply generate signals; it enforces mandatory risk constraints before sending order commands to your MT5 terminal.
 </p>
 </div>

 {/* Risk Control Console Preview */}
 <div className="mt-12 rounded-lg border border-border/80 bg-card/80 p-6 md:p-8 ">
 <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">

 {/* Risk Metrics Cards */}
 <div className="lg:col-span-6 space-y-3 font-numeric text-xs">
 <div className="flex items-center justify-between rounded-xl bg-background/80 p-3.5 border border-border/40">
 <div>
 <div className="font-bold text-foreground">Risk Per Trade</div>
 <div className="text-micro text-muted-foreground">Fixed % allocation per order</div>
 </div>
 <span className="rounded bg-primary/10 px-2.5 py-1 font-bold text-primary border border-primary/20">1.0% Capital</span>
 </div>

 <div className="flex items-center justify-between rounded-xl bg-background/80 p-3.5 border border-border/40">
 <div>
 <div className="font-bold text-foreground">Max Daily Loss Limit</div>
 <div className="text-micro text-muted-foreground">Halts new trades if breached</div>
 </div>
 <span className="rounded bg-negative/10 px-2.5 py-1 font-bold text-negative border border-negative/20">3.0% Max Daily</span>
 </div>

 <div className="flex items-center justify-between rounded-xl bg-background/80 p-3.5 border border-border/40">
 <div>
 <div className="font-bold text-foreground">Max Open Positions</div>
 <div className="text-micro text-muted-foreground">Prevents over-exposure</div>
 </div>
 <span className="rounded bg-info/10 px-2.5 py-1 font-bold text-info border border-info/20">2 / 5 Active</span>
 </div>

 <div className="flex items-center justify-between rounded-xl bg-background/80 p-3.5 border border-border/40">
 <div>
 <div className="font-bold text-foreground">Symbol Exposure Limit</div>
 <div className="text-micro text-muted-foreground">Cap on single symbol lots</div>
 </div>
 <span className="rounded bg-positive/10 px-2.5 py-1 font-bold text-positive border border-positive/20">Controlled</span>
 </div>
 </div>

 {/* Right Protection Features */}
 <div className="lg:col-span-6 space-y-4 text-xs font-numeric">
 <div className="rounded-lg border border-positive/30 bg-positive/5 p-5 space-y-2">
 <div className="flex items-center gap-2 font-bold text-positive">
 <CheckCircle2 size={16} />
 <span>Mandatory Stop Loss Protection</span>
 </div>
 <p className="text-muted-foreground text-micro leading-relaxed">
 Any signal lacking a defined Stop Loss level is automatically flagged as invalid and rejected by the risk validator.
 </p>
 </div>

 <div className="rounded-lg border border-warning/30 bg-warning/5 p-5 space-y-2">
 <div className="flex items-center gap-2 font-bold text-warning">
 <Sliders size={16} />
 <span>Automated Cooldown Window</span>
 </div>
 <p className="text-muted-foreground text-micro leading-relaxed">
 Enforces a 300-second execution cooldown after closed trades to prevent revenge trading or duplicate signal triggering.
 </p>
 </div>

 <div className="rounded-lg border border-negative/30 bg-negative/5 p-5 space-y-2">
 <div className="flex items-center gap-2 font-bold text-negative">
 <AlertOctagon size={16} />
 <span>One-Click Emergency Circuit Breaker</span>
 </div>
 <p className="text-muted-foreground text-micro leading-relaxed">
 Instantly close all open gateway positions and revoke active execution tokens across connected MT5 accounts.
 </p>
 </div>
 </div>

 </div>
 </div>

 </div>
 </section>
 );
}
