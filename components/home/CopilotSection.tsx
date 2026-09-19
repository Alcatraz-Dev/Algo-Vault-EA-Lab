"use client";

import { useState } from "react";
import Link from "next/link";
import { Brain, Send, Sparkles, ArrowRight, User } from "lucide-react";

export default function CopilotSection() {
    const [messages, setMessages] = useState([
        { sender: "user", text: "Analyze XAUUSD market structure on M15 timeframe." },
        { sender: "ai", text: "XAUUSD structure is Trending Bullish on H4 macro with an active M15 Bullish FVG at 2,648.50. Sell-side liquidity was swept at 2,642.10 prior to a CHOCH break. Confidence score: 92/100." },
    ]);
    const [input, setInput] = useState("");

    const handleSend = (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;
        const userMsg = input;
        setInput("");
        setMessages((prev) => [
            ...prev,
            { sender: "user", text: userMsg },
            { sender: "ai", text: `AI Analysis for "${userMsg}": Evaluated using Gemini 3.6 Flash model. Technical indicators align with current risk parameters.` },
        ]);
    };

    return (
        <section className="py-20 border-b border-border/40 bg-card/20 relative overflow-hidden">
            <div className="mx-auto max-w-7xl px-6 md:px-8">
                
                {/* Section Header */}
                <div className="flex flex-col md:flex-row md:items-end md:justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">Conversational AI</p>
                        <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
                            Interactive AI Trading Copilot
                        </h2>
                        <p className="mt-3 text-base text-muted-foreground max-w-2xl">
                            Ask natural language questions about your connected accounts, open risk, market structure, or Pine Script syntax.
                        </p>
                    </div>
                    <Link
                        href="/ai-copilot"
                        className="mt-4 md:mt-0 inline-flex items-center gap-1.5 text-xs font-bold text-violet-400 hover:text-violet-300 transition"
                    >
                        Launch Full AI Copilot <ArrowRight size={14} />
                    </Link>
                </div>

                {/* Copilot Chat UI Box */}
                <div className="mt-12 rounded-3xl border border-border/80 bg-card/80 p-6 md:p-8 shadow-2xl backdrop-blur-xl">
                    <div className="max-w-3xl mx-auto space-y-4">
                        
                        {/* Header */}
                        <div className="flex items-center justify-between border-b border-border/40 pb-3 text-xs font-mono">
                            <div className="flex items-center gap-2">
                                <Brain size={18} className="text-violet-400" />
                                <span className="font-bold text-foreground">AlgoVault AI Copilot (Gemini Engine)</span>
                            </div>
                            <span className="text-emerald-400 font-bold flex items-center gap-1">
                                <Sparkles size={12} /> Model Online
                            </span>
                        </div>

                        {/* Chat Messages Log */}
                        <div className="space-y-3 min-h-[220px] max-h-[300px] overflow-y-auto p-2 font-mono text-xs no-scrollbar">
                            {messages.map((m, idx) => (
                                <div key={idx} className={`flex gap-3 ${m.sender === "user" ? "justify-end" : "justify-start"}`}>
                                    {m.sender === "ai" && (
                                        <div className="h-7 w-7 rounded-lg bg-violet-600 text-white flex items-center justify-center shrink-0">
                                            <Brain size={14} />
                                        </div>
                                    )}
                                    <div className={`rounded-2xl p-3.5 max-w-md ${
                                        m.sender === "user"
                                            ? "bg-violet-600 text-white"
                                            : "bg-background/90 text-foreground border border-border/40"
                                    }`}>
                                        <p className="leading-relaxed text-[11px]">{m.text}</p>
                                    </div>
                                    {m.sender === "user" && (
                                        <div className="h-7 w-7 rounded-lg bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                                            <User size={14} />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Input Bar */}
                        <form onSubmit={handleSend} className="flex gap-2">
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder="Ask AI Copilot (e.g. 'What is my current drawdown across accounts?')..."
                                className="flex-1 rounded-xl border border-border/60 bg-background/90 px-4 py-3 text-xs outline-none focus:border-violet-500 font-mono"
                            />
                            <button
                                type="submit"
                                className="rounded-xl bg-violet-600 px-5 py-3 text-xs font-bold text-white transition hover:bg-violet-500 flex items-center gap-1.5"
                            >
                                <Send size={14} />
                                Send
                            </button>
                        </form>

                    </div>
                </div>

            </div>
        </section>
    );
}
