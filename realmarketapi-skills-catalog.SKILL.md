---
name: realmarketapi-skills-catalog
description: Meta routing skill that selects the right RealMarketAPI skill stack for context, technical analysis, MTF alignment, sentiment, XAUUSD specialization, and final decision outputs.
version: 1.0
author: RealMarketAPI , tradingview 
tags: [meta-skill, routing, trading, orchestration, market-data]
---

# RealMarketAPI Skills Catalog

## Purpose
Route user intent to the best RealMarketAPI skill or skill sequence.

## Available Skills and When to Use Each
- realmarketapi-market-context (High): quick snapshot plus 24h baseline before deep analysis.
- realmarketapi-technical-analysis (High): indicators plus support/resistance plus confluence.
- realmarketapi-multi-timeframe (High): top-down timeframe alignment workflow.
- realmarketapi-xauusd-specialist (High): gold-specific logic, session behavior, ICT/SMC-aware framing.
- realmarketapi-sentiment-analysis (Medium): Fear and Greed style context and composite signal.
- realmarketapi-trading-decision (Medium): end-to-end final bias with invalidation.

## Routing Rules
1. Start with realmarketapi-market-context unless user asks for a narrow task.
2. Add realmarketapi-technical-analysis for indicator or level requests.
3. Add realmarketapi-multi-timeframe for alignment requests.
4. Prioritize realmarketapi-xauusd-specialist when symbol is XAUUSD.
5. Add realmarketapi-sentiment-analysis for confirmation or divergence checks.
6. End with realmarketapi-trading-decision when user asks for final bias.

## Example Orchestration Patterns
- Quick check: market-context.
- Confluence analysis: market-context plus technical-analysis.
- MTF setup: market-context plus technical-analysis plus multi-timeframe.
- Gold setup: market-context plus xauusd-specialist plus trading-decision.
- Full stack: market-context plus technical-analysis plus sentiment-analysis plus trading-decision.

