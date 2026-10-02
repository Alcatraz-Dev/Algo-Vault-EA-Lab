export interface PublicDoc {
  slug: string;
  title: string;
  category: "Platform" | "Market Intelligence" | "Trading Engines" | "Research & Backtesting" | "Integrations";
  description: string;
  lastUpdated: string;
  content: string;
}

export const PUBLIC_DOCS: PublicDoc[] = [
  {
    slug: "ai-market-intelligence",
    title: "AI Market Intelligence & Institutional Signal Framework",
    category: "Market Intelligence",
    description: "Overview of AlgoVault's AI-driven market intelligence, smart money flow analysis, and real-time liquidity detection engines.",
    lastUpdated: "2026-09-30",
    content: `
# AI Market Intelligence & Institutional Signal Framework

AlgoVault Market Intelligence combines real-time order flow analytics, Smart Money Concept (SMC) mapping, multi-timeframe liquidity detection, and AI copilot evaluation to provide institutional-grade trading insights.

## Core Capabilities
* **Order Flow & Smart Money Mapping**: Identifies institutional order blocks, liquidity sweeps, fair value gaps (FVG), and break-of-structure (BOS) signals across Forex, Crypto, and Indices.
* **AI Copilot & Multi-Source Synthesis**: Merges technical indicators, sentiment data, and volume footprint into high-confidence market hypotheses.
* **Automated Risk & Guardrails**: Evaluates market volatility, economic calendar impact, and risk-reward metrics before issuing actionable intelligence.

## Technical Architecture
AlgoVault's Market Intelligence engine operates asynchronously, polling high-frequency price feeds, computing quantitative metrics, and emitting structured JSON intelligence packets to authorized user terminals.
    `.trim(),
  },
  {
    slug: "smart-money-methodology",
    title: "Smart Money Concepts & Liquidity Mapping Methodology",
    category: "Market Intelligence",
    description: "Detailed mathematical and architectural explanation of how AlgoVault identifies liquidity pools, order blocks, and market structure shifts.",
    lastUpdated: "2026-09-30",
    content: `
# Smart Money Concepts & Liquidity Mapping Methodology

AlgoVault's Smart Money Concept (SMC) engine tracks market liquidity dynamics by modeling key price levels where institutional participants accumulate or distribute liquidity.

## Key Algorithmic Components
1. **Liquidity Pool Identification**: Detects equal highs/lows (EQH/EQL) and swing points where retail stop orders cluster.
2. **Order Block Detection**: Highlights the last opposing candle before an impulsive market expansion accompanied by significant volume.
3. **Fair Value Gap (FVG) Calculation**: Measures 3-candle imbalance windows where market efficiency was compromised during rapid price movements.
4. **Market Structure Shift (MSS)**: Triggers alerts when high-tf market structures break, signaling potential trend reversals.
    `.trim(),
  },
  {
    slug: "pro-scalping-terminal",
    title: "Pro Scalping Terminal Architecture & Execution",
    category: "Trading Engines",
    description: "High-velocity scalping interface built for low-latency execution, real-time market depth visualization, and rapid order routing.",
    lastUpdated: "2026-09-30",
    content: `
# Pro Scalping Terminal Architecture & Execution

The AlgoVault Scalping Terminal is designed for high-frequency discretionary and semi-automated scalpers operating on sub-minute to 15-minute timeframes.

## Features
* **Sub-Second Order Dispatch**: Keyboard shortcuts and quick-action tickets for dynamic position scaling.
* **Pine Runtime Integration**: Native interpretation of custom indicators and scalping strategies.
* **Real-time Order Book & DOM**: Level-2 market depth visualization with liquidity delta tracking.
* **Integrated Risk Manager**: Auto-applies trailing stops, maximum daily loss limits, and emergency kill-switch functionality.
    `.trim(),
  },
  {
    slug: "backtesting-methodology",
    title: "Backtesting & Out-Of-Sample Validation Standard",
    category: "Research & Backtesting",
    description: "Rigorous backtest validation protocol, Monte Carlo stress testing, and out-of-sample (OOS) walk-forward analysis methodology.",
    lastUpdated: "2026-09-30",
    content: `
# Backtesting & Out-Of-Sample Validation Standard

To prevent curve-fitting and over-optimization, AlgoVault enforces a 4-phase quantitative validation pipeline for all Expert Advisors (EAs) and strategies hosted on the platform.

## The 4-Phase Validation Pipeline
1. **In-Sample Parameter Research**: Broad historical parameter discovery across multi-year tick datasets.
2. **Out-of-Sample (OOS) Walk-Forward**: Evaluates strategy robustness on unseen market periods to verify statistical expectancy.
3. **Monte Carlo Robustness Testing**: Simulates order randomization, slippage variance, and spread widening across 1,000+ iterations.
4. **Live Paper Trading Benchmark**: Verifies real-time broker execution consistency prior to marketplace listing.
    `.trim(),
  },
  {
    slug: "strategy-builder-methodology",
    title: "AlgoVault Strategy Builder & EA Generator",
    category: "Trading Engines",
    description: "Visual node-based workflow builder and MetaTrader 5 (MT5) Expert Advisor generation specification.",
    lastUpdated: "2026-09-30",
    content: `
# AlgoVault Strategy Builder & EA Generator

The AlgoVault Strategy Builder enables traders to design, backtest, and compile automated MetaTrader 5 (MT5) Expert Advisors without writing code.

## Architecture
* **Visual Node Graph**: Connect entry triggers, indicator filters, risk models, and execution handlers visually.
* **MQL5 Code Generation Engine**: Compiles valid, optimized MQL5 source code with institutional risk controls built-in.
* **Cross-Asset Compatibility**: Native support for Forex majors, XAUUSD gold scalping, index futures, and crypto pairs.
    `.trim(),
  },
  {
    slug: "workflow-automation",
    title: "Workflow Automation & Webhook Integration Spec",
    category: "Integrations",
    description: "Automate custom alerts, Telegram signals, Discord notifications, and webhook triggers across market events.",
    lastUpdated: "2026-09-30",
    content: `
# Workflow Automation & Webhook Integration Spec

AlgoVault Workflow Automation connects real-time market intelligence with external execution tools, communication channels, and messaging platforms.

## Key Triggers & Actions
* **Triggers**: Market Structure Shifts, Smart Money Liquidity Sweeps, Custom Indicator Crosses, Backtest Metric Thresholds.
* **Actions**: Send Telegram Signal Alerts, Dispatch Discord Webhooks, Execute Broker Order Requests, Push Mobile App Notifications.
    `.trim(),
  },
];

export function getPublicDocBySlug(slug: string): PublicDoc | undefined {
  return PUBLIC_DOCS.find((doc) => doc.slug === slug);
}

export function getAllPublicDocs(): PublicDoc[] {
  return PUBLIC_DOCS;
}
