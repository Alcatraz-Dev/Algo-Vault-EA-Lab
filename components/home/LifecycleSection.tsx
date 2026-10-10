"use client";

import { useState } from "react";
import {
 Search,
 BarChart2,
 Code2,
 History,
 Sliders,
 Play,
 Zap,
 ShieldAlert,
 Send,
 Activity,
 RotateCcw,
} from "lucide-react";

const STAGES = [
 { id: "discover", name: "1. Discover", icon: Search, desc: "Scan 10,000+ market bars for recurring structural edges and liquidity patterns." },
 { id: "analyze", name: "2. Analyze", icon: BarChart2, desc: "Evaluate Market Structure (BOS/CHOCH), Fair Value Gaps, and Order Blocks." },
 { id: "build", name: "3. Build", icon: Code2, desc: "Assemble visual rule sets or generate Pine Script v6 / MQL5 code automatically." },
 { id: "backtest", name: "4. Backtest", icon: History, desc: "Simulate strategy performance with realistic spread, slippage, and swap costs." },
 { id: "optimize", name: "5. Optimize", icon: Sliders, desc: "Run parameter grid searches with out-of-sample and Monte Carlo validation." },
 { id: "replay", name: "6. Replay", icon: Play, desc: "Replay market price action bar by bar to verify setup execution in real time." },
 { id: "signals", name: "7. Signals", icon: Zap, desc: "Ingest live multi-channel Telegram messages and parse with AI natural language." },
 { id: "risk", name: "8. Risk", icon: ShieldAlert, desc: "Apply strict position sizing, daily loss limits, and maximum drawdown rules." },
 { id: "execute", name: "9. Execute", icon: Send, desc: "Dispatch trade commands to connected MT4/MT5 terminals via secure HTTP Gateway." },
 { id: "monitor", name: "10. Monitor", icon: Activity, desc: "Track live open positions, automated breakeven, trailing stops, and equity curves." },
 { id: "improve", name: "11. Improve", icon: RotateCcw, desc: "Tag trades in the Trade Journal, analyze execution analytics, and refine parameters." },
];

export default function LifecycleSection() {
 const [selectedStage, setSelectedStage] = useState(0);
 const active = STAGES[selectedStage];

 return (
 <section className="py-20 border-b border-border/40 bg-background/50 relative overflow-hidden">
 <div className="mx-auto max-w-7xl px-6 md:px-8">

 {/* Header */}
 <div className="mx-auto max-w-3xl text-center">
 <p className="text-xs font-semibold uppercase tracking-widest text-primary">Trading Operating System</p>
 <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
 The End-to-End AlgoVault Lifecycle
 </h2>
 <p className="mt-3 text-base text-muted-foreground">
 From initial pattern discovery to live MT5 execution and performance feedback loops.
 </p>
 </div>

 {/* Horizontal Lifecycle Step Chips */}
 <div className="mt-12 flex items-center justify-start gap-2 overflow-x-auto pb-4 no-scrollbar">
 {STAGES.map((s, idx) => {
 const Icon = s.icon;
 const isSelected = selectedStage === idx;
 return (
 <button
 key={s.id}
 type="button"
 onClick={() => setSelectedStage(idx)}
 className={`flex items-center gap-2 shrink-0 rounded-lg border px-3.5 py-2 text-xs font-semibold transition active:scale-95 ${
 isSelected
 ? "border-primary bg-primary/15 text-primary "
 : "border-border/60 bg-card/60 text-muted-foreground hover:bg-muted hover:text-foreground"
 }`}
 >
 <Icon size={14} className={isSelected ? "text-primary" : "text-muted-foreground"} />
 <span>{s.name}</span>
 </button>
 );
 })}
 </div>

 {/* Active Stage Card Visual Detail */}
 <div className="mt-6 rounded-lg border border-border/80 bg-card/80 p-6 md:p-8 ">
 <div className="grid grid-cols-1 gap-6 md:grid-cols-12 md:items-center">
 <div className="md:col-span-7 space-y-4">
 <div className="inline-flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-1 text-xs font-numeric font-bold text-primary">
 STAGE {selectedStage + 1} OF {STAGES.length}
 </div>
 <h3 className="text-2xl font-bold text-foreground">{active.name.split(". ")[1]} Phase</h3>
 <p className="text-sm leading-relaxed text-muted-foreground">{active.desc}</p>

 <div className="pt-2 flex items-center gap-4 text-xs font-numeric text-muted-foreground">
 <span className="flex items-center gap-1.5 text-positive font-semibold">✓ Standardized Pipeline</span>
 <span className="flex items-center gap-1.5 text-info font-semibold">✓ Automated Telemetry</span>
 </div>
 </div>

 <div className="md:col-span-5 rounded-lg border border-border/60 bg-background/80 p-5 font-numeric text-xs space-y-3">
 <div className="flex justify-between border-b border-border/40 pb-2 text-muted-foreground">
 <span>Lifecycle Node</span>
 <span className="text-primary">{active.id.toUpperCase()}</span>
 </div>
 <div className="flex justify-between text-muted-foreground">
 <span>Execution Mode</span>
 <span className="text-positive">Deterministic Engine</span>
 </div>
 <div className="flex justify-between text-muted-foreground">
 <span>Audit Status</span>
 <span className="text-foreground">Verified System</span>
 </div>
 <div className="pt-2 rounded bg-muted/40 p-2.5 text-micro text-muted-foreground">
 Code & API integrations connected natively across AlgoVault modules.
 </div>
 </div>
 </div>
 </div>

 </div>
 </section>
 );
}
