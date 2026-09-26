# Research Evaluation Methodology — Phase 6.4

## Purpose
Compare configurations across existing research layers (historical backtest, OOS, walk-forward, robustness, Monte Carlo) without creating one misleading combined score.

## Principles
- Each layer remains distinct.
- No automatic ranking / optimization / best-configuration claim.
- Missing metrics remain null.
- Evidence must reference actual source results.
- Trading Studio remains the source of truth for strategy definitions.

## Comparison
Uses `compareConfigurations` adapter (existing metrics only).

## Stability
Uses `summarizeStability` adapter — factual summary, no score.

## Selection
Explicit user selection only (`selectConfigurations`).
No AI automatic selection.
