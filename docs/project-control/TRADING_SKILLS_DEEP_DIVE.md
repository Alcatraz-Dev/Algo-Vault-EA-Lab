# AlgoVault — Trading Skills Deep-Dive Audit (Phase 2)

> **Status:** read-only audit. No code, dependency, database, strategy, broker or
> deployment changes were made. The only filesystem change outside a scratch
> directory is this document.
>
> **Date:** 2026-11-23
> **Scope:** the seven mandatory external repositories, plus expanded GitHub
> discovery across quant research, FX/MT5, ICT/SMC and AI trading agents,
> compared against the actual AlgoVault codebase.
>
> **Supersedes:** nothing. This is a new file. No existing audit or
> project-control document was modified or overwritten.

---

## 0. Method, and how to read the confidence labels

| Label | Meaning |
|---|---|
| **VERIFIED** | I cloned the repository and read the actual files (paths and counts quoted below). |
| **INSPECTED** | I read the rendered repository metadata/README and file listing through the GitHub API/search, but did not read the implementation. |
| **ASSUMED** | Inference from naming/description only. Explicitly flagged wherever used. |

**Procedure actually run**

1. Resolved all seven repositories through the GitHub API to confirm existence,
   licence, default branch and last push.
2. Shallow-cloned all seven (`--depth 1`) plus four discovery candidates into a
   scratch directory used only for reading.
3. Enumerated real trees, then read skill entry files, reference documents,
   scripts, tests, licences and per-repo commit dates.
4. Mapped AlgoVault's own capabilities by reading `lib/`, not by trusting
   `docs/project-control/FEATURE_INVENTORY.md` (which is treated as a claim to
   verify).
5. Deleted the scratch clones after extracting the facts in this report.

**Deliberate limitation:** a shallow clone cannot show history depth, contributor
counts or whether a test suite currently passes. Where I report "tests exist" I
mean *files exist and contain real assertions*, not *the suite is green*. I did
not execute any external repository's tests, because that would require
installing dependencies, which the brief forbids.

**Note on the "previous report":** there is no earlier Phase 1 deep-dive file in
`docs/` (the only audit-like file present is
`docs/project-control/FIREBASE_RULES_AUDIT.md`). I therefore did not use, and
did not overwrite, any prior report. Everything below is sourced from the
repositories and the codebase directly.

---

## 1. Findings from the seven mandatory repositories

### 1.1 Summary

| # | Repository | Exists | Licence (verified) | Last commit | Real skill count | Verdict |
|---|---|---|---|---|---|---|
| 1 | `tradermonty/claude-trading-skills` | Yes | **MIT** (`LICENSE`) | 2026-11-22 | **74** skill dirs, 1 133 `.py`, 751 `.md` | **Highest-value source.** Actively maintained, tested scripts, MT5 tooling. |
| 2 | `agiprolabs/claude-trading-skills` | Yes | **MIT** (`LICENSE.md`) | 2026-09-02 | **69** skill dirs, 119 `.py`, 222 `.md` | Strong quant *methodology* corpus; crypto-heavy; almost no tests. |
| 3 | `Jakeschincariol/trader-skill` | Yes | **MIT** | 2026-10-14 | **11** skills, 24 `.py` | Small, coherent, genuinely useful **approval-gate** pattern. Single-commit project. |
| 4 | `MobiusQuant/OpenMobius-skill` | Yes | **Apache-2.0** | 2026-11-12 | 1 skill, **726 concept cards + 1 282 case cards** | Best ICT/SMC **knowledge** asset; content-provenance and hosting caveats. |
| 5 | `pouriamrt/trading-live-claude` | Yes | **NO LICENCE FILE** | 2026-05-13 | 0 skills; ~60 `.py` framework | **Reference-only.** No licence ⇒ all rights reserved. |
| 6 | `velonone/MASTER-Trading-Skills` | Yes | **MIT** | 2026-05-06 | 7 skill packages, 67 `.py` | Compact, real, but marketing claims outrun the code and tests are weak. |
| 7 | `JayLunia/trading-agent-skills` | Yes | **MIT**, `Copyright (c) 2026 TraderMonty` | 2026-10-26 | **74** — identical set | **A 1:1 fork of #1.** Adds no independent capability. |

Two findings change the shape of the whole analysis:

* **#7 is not an independent project.** Its skill directory is byte-for-byte the
  same *set* as #1 (74/74 identical names, `comm -13` returns nothing), it is
  flagged `"fork": true` by the API, its licence names TraderMonty, and it is
  *behind* upstream. It must never be cited as separate corroboration, and
  nothing should be vendored from it.
* **#5 cannot be legally reused.** A public repository without a licence grants
  no rights. Its architecture can be studied and re-derived; its code cannot be
  copied, and a "small change" does not cure that.

### 1.2 `tradermonty/claude-trading-skills` (MIT)

**Verified facts:** 8 024 stars, 1 504 forks, created 2025-10-19, last push
2026-11-22 (a dependabot merge, PR #873) — the only one of the seven with
day-of-audit activity. Layout: `skills/` (74), `skills-index.yaml`, `commands/`,
`agents/`, `workflows/`, `skill-packages/`, `skillsets/`, `conftest.py`,
`pyproject.toml`, `SECURITY.md`, `docs/`.

Skills are not just prose. The canonical shape is:

```
skills/<name>/SKILL.md                  # instructions + hard rules
skills/<name>/references/*.md           # methodology
skills/<name>/scripts/*.py              # deterministic implementation
skills/<name>/scripts/tests/*.py        # real assertions + fixtures
skills/<name>/requirements.txt
```

**What is genuinely reusable**

| Skill | What the code actually does | Why it matters here |
|---|---|---|
| `mt5-robot-tester` | Drives `terminal64.exe` headless through a **3-round pipeline** (per-symbol screen → best-pair backtest → sequential ±50%/5% parameter optimisation), then gates finalists on `profit ≥ 4× deposit` **and** `worst DD ≤ 12%`. Parses the MT5 HTML report (`parse_mt5_report.py`) and the optimisation XML, reconstructs the **balance curve from the deals table** to compute % positive months, all-years-positive, LR correlation and months-to-new-high. Checkpointed and resumable. | This is the only MT5-native, *tested* EA evaluation pipeline found anywhere in the audit. Directly relevant to Strategy Lab / EA Lab. |
| `backtest-expert` | Methodology ("find strategies that break the least") + `evaluate_backtest.py` + `references/failed_tests.md`; stress-test matrix (stop at 50–150 %, target 80–120 %, timing ±15–30 min), parameter-sensitivity and bias checklists. | The *gate language* AlgoVault's research pipeline lacks. |
| `pre-trade-discipline-gate` | Offline checklist gate producing a `pre_trade_discipline_decision` artifact; links to thesis without moving its review schedule. Explicitly cannot place orders. | A clean example of a **research-only skill with zero execution authority**. |
| `drawdown-circuit-breaker` | Reads thesis YAML only; uses realized P&L, losing-streak cooldowns, weekly/monthly DD limits; emits `circuit_breaker_decision`. | Stateful account-level gate; AlgoVault's risk engine is stateless per-intent. |
| `trader-memory-core` | Thesis lifecycle `IDEA → ENTRY_READY → ACTIVE → CLOSED`, JSON-schema validated store, **postmortem with P&L + MAE/MFE**, review scheduling. | AlgoVault has no postmortem/MAE-MFE layer. |
| `vcp-screener` | `references/scoring_system.md` + 10 test files incl. price-gap and contract tests. | Example of a scorable, testable screener contract. |
| `signal-postmortem`, `exposure-coach`, `weekly-performance-digest` | Artifact-producing review skills. | Review-loop mechanics. |
| `skills-index.yaml` | Per-skill registry with `status`, `category`, and a **`verification:` block** (`unit_tests: passed`, `instruction_contract: not_verified`, `financial_logic_review`, `empirical_validation`, …). | The best available model for AlgoVault's skill registry. |

**Dependencies / execution:** Python 3.9+/3.10+, `pyyaml`, `jsonschema`, pandas;
several skills want an **FMP API key** (paid); `mt5-robot-tester` needs
**Windows + a MetaTrader 5 install**. Standard library only for the MT5 parser.

**Operational risk it documents itself (worth inheriting):** the MT5 tester
warns that auto-discovering `terminal64.exe` on a machine that also trades live
will wake the **broker's live terminal** (the generated INI carries no `Login`)
and then `ShutdownTerminal=1` closes it. Their mitigation is an explicit path to
a `/portable`, tester-only install, with `--allow-auto-detect` as an opt-in. Any
AlgoVault implementation must copy that stance.

**Weakness:** equity-focused. Many skills assume US equities + FMP; FX/MT5
coverage is essentially the one tester skill. Chinese/Japanese docs add surface
area. Nothing here is a complete risk or execution engine.

### 1.3 `agiprolabs/claude-trading-skills` (MIT)

**Verified facts:** 69 skill directories, 119 `.py`, 222 `.md`, last commit
2026-09-02. Each skill follows `SKILL.md` + `references/` + `scripts/`. One
top-level test file (`tests/test_drawdown_analyzer.py`) for 119 Python files.

**Content is methodology-heavy and mostly crypto.** Skill nouns:
`walk-forward-validation`, `regime-detection`, `cointegration-analysis`,
`correlation-analysis`, `mean-reversion`, `kelly-criterion`, `position-sizing`,
`risk-management`, `exit-strategies`, `slippage-modeling`,
`market-microstructure`, `market-microstructure-traditional`,
`portfolio-analytics`, `volatility-modeling`, `trade-journal`,
`signal-classification`, `strategy-framework`, plus Solana/DEX/prediction-market
integrations (`helius-api`, `jito-bundles`, `pumpfun-mechanics`, `kalshi-api`,
`polymarket-api`, `mev-analysis`, `sybil-detection`, `wash-sale-detection`).

**Best single document:** `skills/walk-forward-validation/SKILL.md` — a correct,
specific treatment of why k-fold fails on financial series (lookahead,
autocorrelation, regime dependence, label overlap), with rolling vs expanding
windows, **purged CV**, **CPCV**, and overfit-detection metrics. This is the
clearest written specification of the validation discipline AlgoVault needs.

**Weakness:** the ratio of instruction to implementation is high, and the
verification is thin (1 test file). Treat `references/` as a *specification to
implement deterministically*, not as working code. Crypto/Solana skills are
irrelevant to an FX-first product except as pattern references.

### 1.4 `Jakeschincariol/trader-skill` (MIT)

**Verified facts:** 11 skills, 24 `.py`, 1.1 MB, single commit "The Trader skill:
11 Claude skills, v1.0" (2026-10-14). Skills: `trader-alerts`, `trader-analyst`,
`trader-broker`, `trader-budget`, `trader-copycat`, `trader-news`,
`trader-pelosi`, `trader-rebalance`, `trader-risk`, `trader-screener`,
`trader-tax`.

**The valuable idea is the pipeline contract, not the analytics:**

```
screener → budget(size) → risk(check) → broker(approval) → order
```

`trader-risk/SKILL.md` + `check.py` is the strongest pre-trade gate design found:
checks are applied **in file order, as if each already-passed order had filled**,
so a batch that is individually fine but collectively breaches a limit is
caught; each verdict is written with a **fingerprint of the exact order**
(dedupe), and `trader-broker` only surfaces orders that carry a PASS. It blocks
on format, asset class, max order size, min order size, post-fill position %,
cash buffer, margin, shorts, options/crypto policy, malformed input, duplicates
and a daily order cap. `trader-budget` sizes to a cash budget;
`trader-tax/lots.py` does lot-level cost-basis accounting.

**Weaknesses:** single commit, no CI evidence, US-equities/Alpaca assumptions,
`trader-pelosi`/`trader-copycat` scrape public disclosures (13F/PTR) whose
freshness and legality vary by jurisdiction — not a pattern to copy for an EU/FX
product.

### 1.5 `MobiusQuant/OpenMobius-skill` (Apache-2.0)

**Verified facts:** 218 MB working tree (largely `knowledge_base/` + `.npz`
embeddings), 2 016 JSON cards, 18 `.md`, 38 `.py`, last commit 2026-11-12
("v0.4.0 — Antigravity, Grok Bot, Muse & KlineSync"). Layout: `SKILL.md`
(router), `SKILL.body.md`, `knowledge_base/`, `workflows/{qna,analyze,annotate,
klines,analysis_profiles}.md`, `agents/`, `evals/`, `platforms/` (9 agent
platforms), `schemas/`, `install.*`, `PRIVACY.md`, `ATTRIBUTION.md`.

**What the knowledge base actually is:** 726 concept cards + 1 282 case cards
"distilled from 300+ trading videos and live lessons across 12 curated source
collections". 726 individual JSON files, e.g.
`knowledge_base/concepts/fair_value_gap.json`, `break_of_structure.json`,
`order_block.json`, `liquidity_sweep.json`,
`inversion_fair_value_gap.json`, `internal_change_of_character.json`. Card
structure (verified on `fair_value_gap_rebalance.json`):

```json
{ "global_card_id", "global_canonical", "type", "school": "ICT",
  "aliases": ["FVG Rebalance", "缺口回补", ...],
  "definition", "definition_per_source": { "<source>": "..." },
  "identification_rules": [ ... ], "common_mistakes": [ ... ],
  "trading_implication": "..." }
```

Two JSON Schemas exist (`school_projection_v2`, `source_evidence_v2`) and
`evals/retrieval_benchmark_v1.jsonl` + `baseline_v1.json` provide a retrieval
benchmark. Schools covered: ICT/SMC, ChanLun (缠论), Wyckoff, price action,
order flow, VSA, Elliott Wave.

**The routing discipline is the second asset.** `SKILL.md` mandates:
fail-closed capability gate (if no native analyzer exists, stop *before* any
network call), fresh-data-only (never answer a market question from memory),
an explicit `freshness` footer with `is_stale` from the API response, a
canonical data-source disclosure that forbids naming upstream vendors, and
"no fabrication" as the core principle.

**Blockers:** (a) requires a commercial external API `api.mobiusquant.ai`;
(b) content is Chinese-language and second-hand from videos — the *repository*
is Apache-2.0 but the *provenance of the trading claims* is unverifiable;
(c) 218 MB is not vendorable into a Next.js repo.

### 1.6 `pouriamrt/trading-live-claude` (no licence)

**Verified facts:** `src/trading_live_claude/` with `brokers/`,
`backtest/`, `config/`, `data/`, `execution/`, `monitor/`, `risk/`,
`signals/`, `strategies/examples/{bollinger, ema_crossover, macd,
momentum_breakout, pairs, rsi_meanrevert}.py`, `daemon.py`, `cli.py`, `tune.py`.
60 `.py`, 12 test modules, last commit 2026-05-13. No `LICENSE` file.

**The best "separation of research and execution" design in the audit.**
`execution/router.py` calls itself "the ONLY thing that places orders" and
enforces a ladder before dispatch:

* `paper`/`dry-run` — no human confirmation needed;
* `live` — requires the human-typed phrase `I UNDERSTAND THE RISK`;
* `autonomous` — requires the env sentinel `AUTONOMOUS_ENABLED=true` **and** a
  `DailyBudget` cap on trade count and notional, enforced on top of every other
  gate;
* constructing `Router(mode="live"|"autonomous")` directly raises
  `LiveModeNotConfirmed` / `AutonomousNotEnabled`.

Supporting primitives, all small and clean: `risk/heat.py` (portfolio heat vs a
5 % cap, `admits()`), `risk/kill_switch.py` (a `state/HALTED` **sentinel file**
so any shell can halt trading), `risk/sizing.py` (ATR fixed-fractional,
`floor(equity×risk% / (k×ATR))`), `risk/var.py` (one-tail historical VaR),
`execution/journal.py`, `execution/daily_budget.py`.

**Blockers:** no licence (ideas only), Questrade-specific broker, thin metrics,
5 months stale. It is a *pattern library*, not a dependency.

### 1.7 `velonone/MASTER-Trading-Skills` (MIT)

**Verified facts:** 67 `.py`, `backtest/{engine,broker,metrics}.py`,
`skills/{core,agent,inference,signals,execution,adversarial}`, `AGENT_MANIFEST.json`
(schemaVersion 1.0.0, package version 3.1.0), `SKILL.md`/`SKILL_LITE.md`,
14 test files, last commit 2026-05-06 (stale).

**Real, if small:** `backtest/metrics.py` computes Sharpe, Sortino, Calmar, max
DD and **DD duration**, annualised return/vol, win rate, profit factor, and
returns equity/drawdown series + trade log — a sensible metric set.
`skills/signals/technical/kelly.py` is a proper fractional-Kelly sizer
(`fraction=0.25`, `max_position_pct`, `min_edge`, drawdown-aware).
`AGENT_MANIFEST.json` is a genuinely good registry idea: every skill declares
`id`, `entry`, **`tokens`** (context budget), `dependencies` and `triggers`.

**Overclaiming, verified:** the manifest advertises "TDA, chaos theory,
adversarial RL market making, genetic programming". The modules exist but are
thin and depend on optional heavy packages (`ripser`, `persim`) imported lazily.
More importantly the test suite is not a validation signal —
`tests/test_adversarial.py` asserts `signal.action in (HOLD, BUY, SELL)`, which
every implementation passes. The "57 tests, >90 % coverage" claim in `SKILL.md`
should not be repeated.

### 1.8 `JayLunia/trading-agent-skills` (MIT, fork)

**Verified facts:** `"fork": true`; `LICENSE` reads `Copyright (c) 2026
TraderMonty`; 74 skill directories, identical set to #1 (`comm -13` produced no
output); 871 `.py` vs 1 133 upstream; last commit 2026-10-26
("docs: add multi-agent setup and launch positioning"). It is a lagging mirror
with extra docs. **Zero unique trading capability. Exclude from all sourcing.**

---

## 2. Additional GitHub discoveries

Selected for real implementation + permissive licence + maintenance. Verification
level noted, because several are young projects.

| Repository | Licence | Evidence | What it adds |
|---|---|---|---|
| `Khaymat/pyvsmc` | MIT | **VERIFIED** clone: `src/pyvsmc/{fvg,structure,order_blocks,liquidity,swings,zones}.py`, 10 test modules, benchmarks, `py.typed` | Vectorised NumPy/Numba SMC: FVG + CE50 + IFVG, first-cross BOS/CHoCH, OB zone modes/breaker, EQH/EQL sweeps, premium/discount + **OTE 0.618/0.705/0.786**. The best available *algorithmic* ICT reference for parity testing. |
| `joshyattridge/smart-money-concepts` | MIT | INSPECTED (157 commits, PyPI `0.0.27`, tests/) | Canonical, widely used SMC implementation (`smc.fvg`, `smc.swing_highs_lows`, `smc.bos_choch`, `smc.ob`, `smc.liquidity`) with mitigation indices. |
| `hudson-and-thames/arbitragelab` | BSD-3-Clause | INSPECTED (1 397 commits, v1.0.0, docs read) | Cointegration (Engle-Granger, **Johansen**), hedge-ratio estimation (TLS/OLS/Box-Tiao/min half-life), ADF, **Hurst exponent**, Ornstein-Uhlenbeck, copula, ML spread selection. The reference for statistical arbitrage. |
| `AgentJDrew/backtest-guard` | MIT | **VERIFIED** clone: `dsr.py`, `pbo.py`, `purged_kfold.py`, `leakage.py`, `report.py`, 6 test modules | Deflated/Probabilistic Sharpe, **PBO via CSCV**, purged K-fold, lookahead-bias detection. Small and auditable. |
| `abhinay/skepsis` | Apache-2.0 | INSPECTED (40 commits, docs + notebooks + HTML report) | Same statistics, but reports *which diagnostics could not run and why* — an honesty pattern worth copying. |
| `TauricResearch/TradingAgents` | Apache-2.0 | INSPECTED (516 commits, v0.7.1 2026-10-27, CHANGELOG read) | Analyst reports → bull/bear debate → research manager → trader → three-perspective risk review; point-in-time decision-log memory; look-ahead fixes across FRED/sentiment. Research-only, explicitly not a live signal source. |
| `vincentwongso/mt5-trading-mcp` | MIT | **VERIFIED** clone: `src/mt5_mcp/policy/{engine,preflight,consent,idempotency,audit}.py`, `tools/{account,history,market,orders,positions,system}.py`, `mql5/AgentScreenshot.mq5` | MT5 exposed to agents with **consent previews, price-drift retry validation, idempotency, append-only JSONL audit**. The closest existing implementation of "agent may propose, human approves, log everything". |
| `basharat78/open-mt5-gateway` | MIT | INSPECTED (created 2026-11-16, very new) | Zero-DLL model: a python TCP server + a **pure-MQL5 EA that dials outward** (`SocketCreate/SocketConnect`) — the same topology as AlgoVault's EA-polls-RTDB gateway, and evidence that topology is sound on macOS/Linux. |
| `landtml/quantowl` | **unverified** | INSPECTED (README only) | AFML toolkit: purged/combinatorial CV, triple-barrier labels, fractional differentiation, PBO, DSR, HRP. Useful as a spec; licence must be checked before any use. |
| `SirDaniell/MT5Bridge_Linux`, `akivajp/mt5-bridge`, `PTHAICAP/mt5-python-bridge` | MIT | INSPECTED | Linux/Wine + REST bridges; `mt5-python-bridge` documents the silent-failure modes (`symbol_info` returning `None` for `XAUUSD.m`, `initialize()` staying `True` after the link drops) that AlgoVault's gateway must not reproduce. |

**Rejected during discovery:** `rafalsza/smartmoneyconcepts` and
`Prasad1612/SMC-Screener`, `darkosedam-svg/ict-smc-detector`,
`Louisjzhao/smc-toolkit`, `frankabingale1111/smc-backtest`, `AkhileshSelvan/smc-mcp`
(thin, few commits or duplicate of the above); the DSR/PBO long tail
(`CH4RL3I/fluke`, `DaniyalMlk/holdout`, `jarvisss007/backtest-overfitting`,
`0scarito/deflated-alpha`, `Aliipou/backtest-audit`, `Kodezilla0725/deflated-sharpe`,
`mnemox-ai/deflated-sharpe`) — the algorithm is ~60 lines of closed-form maths;
adding a Python dependency for it is unjustified.

---

## 3. AlgoVault capability baseline (what already exists)

Measured by reading `lib/`, not by trusting the feature inventory.

| Area | Reality in the codebase |
|---|---|
| AI | `lib/ai/router.ts` (single `AIRouter`, one default instance), `lib/ai/providers`, `budget.ts`, `provenance.ts`, `local.ts`; agent surface in `lib/agent/*` and `lib/agents/*` |
| Agent tooling | `lib/agent/tools/registry.ts` — single choke point, `evaluatePolicy` on every call, output sanitisation/redaction, 24 000-char cap; `lib/agent/policies/permission-engine.ts` — explicit `AgentPermission` union, per-mode capability matrix, `ToolPolicyDeclaration.requires / requiresConfirmation`, **fail-closed** |
| Risk | `lib/risk/risk-engine.ts` — pure, deterministic, no DB/AI access, always approves protective actions, conservative same-bar SL-first policy; `lib/risk/tests/` |
| Strategy / backtest | `lib/strategy-engine/{backtest,simulation,metrics,risk,replay,versioning,validation}.ts`; slippage + spread + commission modelled per leg (`simulation.ts`); `lib/strategy-lab/{validation,optimization,robustness,forward,metrics}.ts` |
| Research | `lib/strategy-research/{robustness,scoring,validation,orchestrator,runner,memory,fingerprint}.ts`; `lib/market-intelligence/research/{oos/walk-forward,monte-carlo/runner}`; `lib/portfolio/monte-carlo.ts` |
| ICT / structure | `lib/market-core/smart-money/{structure,zones,liquidity,premium-discount,sessions}.ts`, `lib/market-intelligence/smart-money/engine.ts`, `lib/analytics/{market-structure,zones,liquidity,sessions,multi-timeframe}.ts` |
| Order flow | `lib/order-flow/{absorption,delta,footprint,imbalance,liquidity,volume-profile,gex,…}.ts` |
| Regime | `lib/analytics/market-regime.ts`, `lib/cross-asset/regime.ts` (`computeMarketRegime`), `lib/portfolio/regime.ts` |
| MT5 | `MQL5/AlgoVaultTradeGateway/AlgoVaultTradeGateway.mq5` (single EA), unified trading service + `/api/trading/*` |
| Portfolio | `lib/portfolio/{correlation,concentration,exposure,stress,risk-budgets,monte-carlo,no-lookahead}.ts` |

Keyword census over `lib/ app/ components/ features/` (file counts, not quality):
walk-forward 66, Monte-Carlo 78, FVG 132, order block 112, BOS 83, CHoCH 71,
liquidity sweep 119, slippage 186, robustness 70, correlation 123 — but
**`kelly` 3 (all marketing copy in `lib/tools-catalog.ts`)**, **`cointegrat` 0**,
**`deflated`/`PBO` 0**, **`VaR` 0**, **`overfit` 9 (checklists, not tests)**.

Two concrete quality findings from reading the code:

1. `lib/market-intelligence/validation/pipeline.ts` returns canned stage
   objects, e.g. `runWalkForward` → `{stage:"WALK_FORWARD", status:"COMPLETED",
   note:"Existing Walk-Forward engine reused."}` — a pipeline that *reports*
   stages without executing them. Genuine engines exist elsewhere in the repo,
   so this looks like an un-wired adapter; it is a correctness and credibility
   risk and should be either wired to the real engine or removed.
2. `lib/tools-catalog.ts` advertises "Kelly criterion & half-Kelly position
   sizing" and "Monte-Carlo ruin distribution (1000 paths)" in a Pro feature
   list while no Kelly implementation exists in `lib/`. Marketing copy is
   currently ahead of the code.

---

## 4. Real Skills Catalog

Columns follow the brief. "Overlap" is against AlgoVault's actual code.
Priority: **P0** = closes a correctness/credibility gap now; **P1** = clear
product value; **P2** = optional.

| Skill | Repository | Category | Functionality (verified) | Implementation | Dependencies | Licence | Tests | AlgoVault overlap | Integration | Security | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `backtest-expert` | tradermonty | Quant | Stress-test methodology, param-sensitivity matrix, failure catalogue, `evaluate_backtest.py` | Instructions + Python | Python 3.9+ | MIT | 1 test module | **Partial** (`lib/strategy-lab/robustness.ts` warns, doesn't gate) | Adapt (methodology → native rules) | None | P0 |
| `mt5-robot-tester` | tradermonty | MT5 / Quant | Headless `terminal64.exe` 3-round EA pipeline; HTML + optimisation-XML parsers; balance-curve reconstruction; resumable | Python stdlib + MQL5 runtime | Windows, MT5, tick data | MIT | 6 test modules + fixtures | **Missing** (AlgoVault has no EA batch tester) | Adapt | **High**: can hijack/close a live terminal | P1 |
| `pre-trade-discipline-gate` | tradermonty | Risk | Offline checklist → `pre_trade_discipline_decision`; no broker calls | Instructions + Python | Python 3.9+ | MIT | present | **Partial** (risk engine is numeric, not checklist) | Reuse pattern | None | P1 |
| `drawdown-circuit-breaker` | tradermonty | Risk | Realized-P&L DD breaker, losing-streak cooldown, weekly/monthly caps from local state | Python + YAML | pyyaml | MIT | present | **Missing** (risk engine is stateless per intent) | Adapt | None | P0 |
| `trader-memory-core` | tradermonty | AI / Memory | Thesis lifecycle, JSON-schema store, **postmortem P&L + MAE/MFE**, review scheduling | Python + JSON Schema | pyyaml, jsonschema, (FMP for MAE/MFE) | MIT | schema + tests | **Missing** (only `lib/strategy-engine/trace.ts`) | Adapt | Low; FMP key needed for MFE | P1 |
| `signals / market-top / breadth / distribution-day` | tradermonty | Quant | Market-environment, top/bubble, breadth, FTD and distribution-day monitors | Python + data APIs | FMP/Polygon keys | MIT | present | **Partial** (`lib/analytics/market-score.ts`, `breadth` absent) | Native re-spec | Paid data keys | P2 |
| `walk-forward-validation` | agiprolabs | Quant | Rolling/expanding, purged CV, **CPCV**, label-overlap and regime-aware validation | Instructions (+ light scripts) | pandas/numpy/sklearn | MIT | 1 repo-level test | **Partial** (`strategy-lab/forward.ts` + `research/oos/walk-forward.ts` exist; purge/embargo not evidenced) | Adapt → native | None | P0 |
| `kelly-criterion` | agiprolabs | Risk | Fractional Kelly with constraints | Instructions + script | numpy | MIT | none seen | **Missing** (only copy in `tools-catalog.ts`) | Native (~40 lines) | None | P0 |
| `risk-management` | agiprolabs | Risk | Position sizing, exposure caps, drawdown rules | Instructions | — | MIT | none seen | **Existing** (`lib/risk`) | Reuse for wording only | None | P2 |
| `regime-detection` | agiprolabs | Quant | Regime classification for validation and conditioning | Instructions + script | numpy | MIT | none seen | **Existing** (`lib/analytics/market-regime.ts`, `cross-asset/regime.ts`) | Enhance (regime-conditioned OOS) | None | P1 |
| `cointegration-analysis` | agiprolabs | Quant | Pair/portfolio cointegration screening | Instructions | statsmodels | MIT | none seen | **Missing** (`cointegrat` = 0 hits) | Native via `lib/portfolio` | None | P1 |
| `exit-strategies` | agiprolabs | ICT / Execution | Exit models (time, structure, trailing, partials) | Instructions + script | — | MIT | none seen | **Partial** (`strategy-engine/orders.ts`) | Adapt | None | P2 |
| `slippage-modeling` | agiprolabs | Execution | Slippage/impact parameterisation | Instructions | numpy | MIT | none seen | **Partial** (`simulation.ts` has fixed spread/slippage) | Adapt (calibration, not model) | None | P1 |
| `trade-journal` | agiprolabs | AI | Journal schema + review workflow | Instructions | — | MIT | none seen | **Missing** | Reuse with `trader-memory-core` | None | P1 |
| ICT/SMC knowledge base | MobiusQuant | ICT | 726 concepts + 1 282 cases, `identification_rules`, `common_mistakes`, `definition_per_source`, alias index, 2 JSON Schemas, retrieval benchmark | JSON + embeddings (`.npz`) | commercial API for data | **Apache-2.0** | `evals/` benchmark | **Partial** (detectors exist, no doctrine/citation layer) | Adapt (subset, translated, cited) | **High**: second-hand video provenance, Chinese, 218 MB, external API | P1 |
| Fail-closed capability gate + freshness footer | MobiusQuant | AI | Refuse to analyse when no native analyzer exists; never answer from memory; disclose staleness | Instructions | — | Apache-2.0 | — | **Partial** (`lib/agent/core/scope-guard.ts`) | Reuse pattern | None | P0 |
| `trader-risk` (pre-trade gate) | Jakeschincariol | Risk | Sequential fill simulation, order fingerprinting/dedupe, PASS/BLOCK verdict store, broker sees only PASS | Python | stdlib | MIT | — | **Partial** (risk engine rejects, but no fingerprint/dedupe, no batch-order simulation) | Adapt | Low | P0 |
| `trader-budget` / `trader-tax` | Jakeschincariol | Risk / Ops | Cash-budget sizing; lot-level cost basis | Python | stdlib | MIT | — | **Partial** (`lib/portfolio`) | Reuse if tax surface ships | Jurisdiction-specific | P2 |
| Execution router (`router.py`) | pouriamrt | Execution | Typed live-confirmation phrase, `AUTONOMOUS_ENABLED` sentinel, daily trade/notional budget, single order choke point | Python | stdlib | **None** | 12 test modules | **Partial** (unified trading service + risk engine, but no typed-confirmation or daily-budget primitive) | **Re-derive only** | Licence blocks copying | P0 |
| Kill switch + portfolio heat + VaR | pouriamrt | Risk | `state/HALTED` sentinel; heat vs cap; historical VaR | Python | numpy/pandas | **None** | `test_risk.py` | **Partial** (heat/limits inside risk engine; no file sentinel, no VaR) | Re-derive | Licence blocks copying | P1 |
| `backtest/metrics.py` | velonone | Quant | Sharpe, Sortino, Calmar, max DD **duration**, profit factor, equity/DD series | Python | numpy/pandas | MIT | weak | **Existing** (`strategy-engine/metrics.ts`) | Skip | — | P2 |
| Fractional Kelly sizer | velonone | Risk | `fraction`, `max_position_pct`, `min_edge`, drawdown-aware | Python | stdlib | MIT | weak | **Missing** | Native | — | P0 |
| `AGENT_MANIFEST.json` | velonone | AI | Per-skill `id`, `entry`, **token budget**, `dependencies`, `triggers` | JSON | — | MIT | — | **Missing** (tool registry has no token/context budget) | Reuse shape | — | P0 |
| `skills-index.yaml` verification block | tradermonty | AI | Per-skill status + verification evidence matrix | YAML | — | MIT | — | **Missing** | Reuse shape | — | P0 |
| PBO + Deflated Sharpe | backtest-guard | Quant | DSR, PSR, **PBO/CSCV**, MinTRL, purged K-fold, lookahead detection | Python | numpy/scipy | MIT | 6 test modules | **Missing** | **Native TS** (closed form) | None | P0 |
| SMC detection parity | pyvsmc | ICT | FVG/CE50/IFVG, first-cross BOS/CHoCH, OB modes/breaker, EQH/EQL, premium-discount, OTE | NumPy/Numba + Polars | numba, numpy | MIT | **10 test modules**, typed | **Partial** (`market-core/smart-money` simplified) | Harness/parity only | None | P1 |
| Cointegration / Johansen / Hurst | ArbitrageLab | Quant | Engle-Granger, Johansen, hedge ratios, Hurst, OU, copula, ML spread selection | Python | statsmodels, sklearn | **BSD-3** | large suite | **Missing** | Native re-spec | None | P1 |
| MT5 policy/consent/audit layer | mt5-trading-mcp | MT5 / Execution | Preflight, consent preview + price-drift revalidation, idempotency, append-only audit | Python | MetaTrader5, FastAPI | MIT | tests present | **Partial** (gateway has heartbeat/snapshot, no consent/audit envelope) | Adapt | **High**: places real orders; no fsync | P1 |
| Multi-agent debate + risk team | TradingAgents | AI | Analyst reports → bull/bear debate → manager → trader → 3-way risk review; point-in-time memory | Python | LLM keys | Apache-2.0 | tests/ | **Partial** (`lib/ai-trading-teams`, `lib/agents/orchestrator`) | Concept only | LLM cost; research-only | P2 |

---

## 5. The 15 highest-value capabilities

Ranked by value to AlgoVault, not by repository prominence. Each entry answers
the brief's six questions. "Complexity" is engineering effort for the *AlgoVault*
implementation, excluding review.

### 1. Deflated Sharpe Ratio + PBO/CSCV gate — **P0**
*Why:* the single credibility mechanism that separates a research toy from a
quant product; it is the exact answer to "you tried 200 variants and reported
the best".
*Problem solved:* parameter-optimiser output is currently accepted at face
value; `lib/strategy-research/robustness.ts` only *warns*.
*Already has:* `robustness.ts` warning framework, `optimization.ts`, Monte-Carlo
runners, `scoring.ts`.
*Integrate:* add `deflatedSharpe()` / `pboCscv()` / `expectedMaxSharpe()` as pure
functions in `lib/strategy-research/`, feed the existing `(T×N)` variant matrix,
surface as a hard gate + a warning dimension.
*Internal Skill:* yes. *Deterministic:* **must be** (closed form; no AI).
*Complexity:* **Low** (2–4 days + fixtures).

### 2. Purged / combinatorial cross-validation with embargo — **P0**
*Why:* walk-forward with overlapping horizons silently leaks; AlgoVault's
existing forward tests share label windows.
*Problem:* `lib/strategy-lab/forward.ts` and `research/oos/walk-forward.ts`
produce windows but no purging/embargo evidence.
*Already has:* window generation, OOS stage, replay.
*Integrate:* add `purgedSplit()` / `embargoPct` to the existing window
generator; make `lib/market-intelligence/validation/pipeline.ts` call the real
engine instead of returning a canned `COMPLETED`.
*Internal Skill:* yes. *Deterministic:* must be. *Complexity:* **Low–Medium**.

### 3. Account-level drawdown circuit breaker + losing-streak cooldown — **P0**
*Why:* per-intent risk cannot see a losing streak; today a strategy can re-enter
30 seconds after hitting a daily limit.
*Problem:* `lib/risk/risk-engine.ts` is deliberately pure and stateless — good —
but nothing outside it owns *state* across the day.
*Already has:* limits, daily-loss %, drawdown %, protective bypass.
*Integrate:* a stateful *pre-gate* that runs before the pure engine and can only
**subtract** permission (never approve what the engine rejected); state in RTDB
keyed by account; expose `circuit_breaker_decision`.
*Internal Skill:* yes. *Deterministic:* must be. *Complexity:* **Medium**.

### 4. Typed live-confirmation + autonomous sentinel + daily notional budget — **P0**
*Why:* the difference between "AI can propose a trade" and "AI can spend money".
*Problem:* `lib/agent/policies` has strong *file/terminal* permissions but no
trade-execution permission class; the unified trading service has no typed
confirmation primitive or daily notional cap.
*Already has:* fail-closed `evaluatePolicy`, `requiresConfirmation`, gateway
heartbeat, `lib/risk`.
*Integrate:* add `trade.execute.paper` / `trade.execute.live` permissions, a
`DailyBudget` (count + notional) and a confirmation token to
`permission-engine.ts`; live stays **blocked by default** like `git_push`.
*Internal Skill:* no — this is platform policy, not a skill.
*Deterministic:* must be. *Complexity:* **Medium**.

### 5. Order fingerprinting + sequential batch validation — **P0**
*Why:* duplicate orders after a retry, and batches that are individually legal
but jointly breach exposure, are the two classic ways an automated desk loses
money.
*Problem:* `lib/risk` evaluates one intent at a time and has no dedupe key.
*Already has:* idempotency concepts in the gateway, per-symbol exposure limits.
*Integrate:* stable `intentFingerprint` (symbol/side/volume/SL/TP/bucket) +
`validateBatch()` that simulates fills in order before dispatch.
*Internal Skill:* yes (adapter over the engine). *Deterministic:* must be.
*Complexity:* **Low**.

### 6. MT5 Strategy Tester report parser + EA batch pipeline — **P1**
*Why:* AlgoVault ships a gateway but cannot evaluate third-party EAs, which is
the actual "EA lab" promise.
*Problem:* no headless tester orchestration, no report ingestion.
*Already has:* MQL5 gateway, Strategy Lab UI, backtest engine.
*Integrate:* port `parse_mt5_report.py` logic (HTML **and** ES/EN labels, space
thousands separators, deals-table balance reconstruction) to TS for ingestion;
keep *execution* on a portable tester-only Windows host, never the live terminal.
*Internal Skill:* yes (`av.mt5.ea-tester`), research-only output.
*Deterministic:* yes (parsing), no (the tester itself).
*Complexity:* **High** (Windows infra + fixtures).

### 7. ICT doctrine layer with citation (Mobius KB subset) — **P1**
*Why:* AlgoVault detects structure but cannot *explain* it against a doctrine,
which is what users ask for and what makes an AI answer auditable.
*Problem:* `lib/market-core/smart-money` encodes simplified rules with no source,
no `identification_rules`, no `common_mistakes`.
*Already has:* detectors, `lib/market-intelligence/knowledge`, Candel evidence
builder.
*Integrate:* ingest a **curated, translated, attributed subset** of concept
cards (FVG/OB/BOS/CHoCH/liquidity/premium-discount/sessions) as static JSON with
`definition` + `identification_rules` + `source`; retrieve, cite, never expose
raw card text as instructions.
*Internal Skill:* yes (`av.ict.doctrine`). *Deterministic:* retrieval is;
generation is not.
*Complexity:* **Medium** (curation > code).

### 8. Detection parity harness against a vectorised SMC reference — **P1**
*Why:* `FEATURE_INVENTORY` already flags "simplified detector", "post-hoc CHoCH
flips" and "label congestion" — the fix needs a ground truth.
*Problem:* no oracle to prove AlgoVault's FVG/OB/BOS/CHoCH agree with an
independent implementation.
*Already has:* two parallel detector stacks (`market-core` and
`market-intelligence`).
*Integrate:* offline fixture suite: fixed OHLCV in, event sets out, compared
against `pyvsmc`/`smartmoneyconcepts` output committed as golden JSON; resolve
divergences as explicit policy (e.g. first-cross BOS, mitigation by close vs
wick).
*Internal Skill:* no — test infrastructure.
*Deterministic:* yes. *Complexity:* **Medium**.

### 9. Trade journal + thesis lifecycle with MAE/MFE postmortem — **P1**
*Why:* the retention loop; users cannot improve without "what happened vs what I
thought".
*Problem:* `lib/strategy-engine/trace.ts` traces execution but nothing owns a
thesis, a review date, or `MAE/MFE`.
*Already has:* `lib/intelligence/memory`, `lib/candel` workspace, trade history.
*Integrate:* thesis object + state machine + postmortem computed from candles
(no external API needed for MAE/MFE — compute from stored OHLC).
*Internal Skill:* yes (`av.memory.thesis`). *Deterministic:* yes.
*Complexity:* **Medium**.

### 10. Cointegration / Johansen / Hurst / half-life screening — **P1**
*Why:* opens market-neutral strategies, the one strategy family AlgoVault has
zero support for (`cointegrat` = 0 hits) despite shipping pairs tooling.
*Problem:* correlation ≠ cointegration; `lib/portfolio/correlation.ts` alone
produces spurious pairs.
*Already has:* correlation, portfolio construction, backtest engine.
*Integrate:* Engle-Granger (2-asset) + ADF + Hurst + OU half-life in TS; Johansen
only if a matrix solver is justified, otherwise expose as research-only Python
sidecar. Feed `lib/strategy-engine` strategies, not a new engine.
*Internal Skill:* yes (`av.research.cointegration`). *Deterministic:* yes.
*Complexity:* **Medium–High** (numerics).

### 11. Slippage / spread / impact calibration from realised fills — **P1**
*Why:* AlgoVault backtests with *configured* costs; the gap between configured
and realised cost is where "profitable backtest, losing account" comes from.
*Problem:* `simulation.ts` takes `typicalSpread`/`slippagePips` as constants.
*Already has:* per-leg cost model, gateway fill snapshots, replay.
*Integrate:* estimate per-symbol, per-session, per-size realised slippage from
gateway fills; feed back as the default cost profile; show configured vs realised
in Strategy Lab.
*Internal Skill:* yes (`av.execution.cost-model`). *Deterministic:* yes.
*Complexity:* **Medium**.

### 12. Regime-conditioned validation — **P1**
*Why:* a strategy validated only in trending regimes is not validated.
*Problem:* regime engines exist (`market-regime.ts`, `cross-asset/regime.ts`)
but OOS results are not segmented by regime.
*Already has:* regime classification, OOS windows, scoring.
*Integrate:* tag every OOS window with its regime mix; require minimum coverage
per regime or emit an explicit `INSUFFICIENT_REGIME_COVERAGE` warning.
*Internal Skill:* yes. *Deterministic:* yes. *Complexity:* **Low**.

### 13. Skills registry with verification matrix + context budgets — **P0**
*Why:* without it every new capability becomes unreviewable prose; with it,
"is this skill trustworthy?" has an answer.
*Problem:* AlgoVault has a *tool* registry but no *skill* concept: no version, no
verification evidence, no token budget, no artifact schema.
*Already has:* `lib/agent/tools/registry.ts`, `evaluatePolicy`, redaction, event
log.
*Integrate:* `lib/skills/` manifest (`id`, `version`, `hash`, `kind:
research|execution`, `requires`, `tokens`, `inputs`, `outputs`, `verification`),
registered as tools so policy still applies.
*Internal Skill:* it *is* the substrate. *Deterministic:* yes.
*Complexity:* **Medium**.

### 14. Fail-closed capability gate + freshness/evidence footer — **P0**
*Why:* the most damaging failure mode for a trading AI is a confident answer
built from stale or absent data.
*Problem:* today the AI layer can answer a market question from model memory.
*Already has:* `lib/ai/provenance.ts`, `scope-guard.ts`, Candel evidence rules.
*Integrate:* every market-analysis response must carry
`{source, symbol, timeframe, fetchedAt, lastBarAgeSeconds, isStale}`; if the
required analyzer is unavailable, **stop before** any model call.
*Internal Skill:* no — response contract. *Deterministic:* yes.
*Complexity:* **Low** (enforcement is the work).

### 15. Kelly / half-Kelly sizing with drawdown guardrails — **P1**
*Why:* it is already advertised in `lib/tools-catalog.ts` and does not exist;
shipping the claim is cheaper than retracting it, and it is ~40 lines.
*Problem:* sizing is currently risk-%-based only.
*Already has:* `lib/risk/risk-engine.ts` sizing path, `order-flow` stats.
*Integrate:* expose fraction + caps as an *option* on `OrderIntent`, clamped by
the existing engine (Kelly can only reduce size below the risk-% ceiling, never
raise it).
*Internal Skill:* yes. *Deterministic:* yes. *Complexity:* **Low**.

*Runners-up (16–20):* market breadth / distribution-day monitors; weekly
performance digest; exposure coach (earnings/macro event exposure); trade tax-lot
accounting; multi-agent bull/bear debate (concept only).

---

## 6. AlgoVault capability gaps

| Capability | AlgoVault today | Evidence | Gap |
|---|---|---|---|
| Overfitting statistics (DSR, PBO, MinTRL) | absent | 0 hits for `deflated`/`PBO` in `lib/` | **Missing** |
| Purged / combinatorial CV, embargo | partial | `forward.ts`, `oos/walk-forward.ts`; no purge/embargo | **Missing** |
| Validation pipeline that actually runs | broken-ish | `market-intelligence/validation/pipeline.ts` returns canned `COMPLETED` | **Defect** |
| Kelly sizing | claim only | `kelly` appears only in `lib/tools-catalog.ts` | **Missing / misadvertised** |
| Cointegration / stat-arb | absent | 0 hits for `cointegrat` | **Missing** |
| Historical VaR / CVaR | absent | `VaR` only as "cash value at risk" prose | **Missing** |
| Stateful drawdown/losing-streak breaker | partial | `lib/risk` is stateless by design; `lib/portfolio/risk-budgets.ts` is allocation-scoped | **Missing** |
| Daily notional/trade budget for autonomy | absent | no `DailyBudget` concept | **Missing** |
| Order fingerprint / batch validation | absent | risk engine is single-intent | **Missing** |
| Typed live confirmation | absent | no confirmation primitive in trading path | **Missing** |
| EA batch testing / MT5 report ingestion | absent | only `AlgoVaultTradeGateway.mq5` | **Missing** |
| Trade journal + MAE/MFE postmortem | absent | only `strategy-engine/trace.ts` | **Missing** |
| ICT doctrine + citation layer | partial | detectors exist; `market-intelligence/knowledge` has no sourced doctrine | **Partial** |
| Detector parity oracle | absent | no golden fixtures | **Missing** |
| Realised-cost calibration | partial | constants in `simulation.ts` | **Improvement** |
| Regime-conditioned validation | partial | regime engines exist; OOS not segmented | **Improvement** |
| Skill registry / verification matrix | partial | tool registry exists; no skill manifest/version/verification | **Improvement** |
| Freshness/evidence contract | partial | `lib/ai/provenance.ts` exists; not mandatory on market answers | **Improvement** |
| Correlation / exposure / stress | strong | `lib/portfolio/*` | None |
| Deterministic risk engine | strong | `lib/risk/risk-engine.ts` | None |
| Policy engine (fail-closed) | strong | `lib/agent/policies/*` | None |
| Order-flow analytics | strong | `lib/order-flow/*` (22 modules) | None |

**Explicitly not to be replaced** (per the brief, and independently correct):
the AI Router, Strategy Engine, Risk Engine, backtesting pipeline, MT5 gateway
and Market Intelligence. Nothing above proposes a competing engine; every item
is a new pure function, a new state store, or a contract around existing code.

---

## 7. Recommended internal Skills catalog

Twelve skills, each a thin, versioned, deterministic unit behind the existing
policy engine. `kind` decides authority: **research** skills may read and
compute; **execution** skills may only emit an `OrderIntent` that the canonical
risk engine still has to approve.

| Skill id | Kind | Deterministic | Inputs → Outputs | Wraps / extends |
|---|---|---|---|---|
| `av.research.overfit-audit` | research | yes | variant return matrix → DSR, PSR, PBO, MinTRL, verdict | `lib/strategy-research/robustness.ts` |
| `av.research.cv-split` | research | yes | bars + horizon → purged/embargoed folds | `strategy-lab/forward.ts` |
| `av.research.regime-coverage` | research | yes | OOS windows + regime series → coverage report | `analytics/market-regime.ts` |
| `av.research.cointegration` | research | yes | price matrix → pairs, hedge ratio, ADF, Hurst, half-life | new; feeds `strategy-engine` |
| `av.risk.pre-trade-gate` | research | yes | intents + limits + state → PASS/BLOCK + fingerprints | `lib/risk/risk-engine.ts` |
| `av.risk.account-breaker` | research | yes | realized P&L, streaks, equity → allow/deny today | new state store |
| `av.risk.sizing-kelly` | research | yes | win rate, payoff, DD → size (≤ risk-% ceiling) | `risk-engine` sizing path |
| `av.execution.cost-model` | research | yes | fills + candles → per-symbol/session slippage profile | `strategy-engine/simulation.ts` |
| `av.mt5.ea-tester` | research | no (external) | EA folder + config → report artifacts + verdict | new ingestion; portable terminal only |
| `av.ict.doctrine` | research | retrieval yes | concept query → sourced definition + identification rules | `market-intelligence/knowledge` |
| `av.memory.thesis` | research | yes | thesis events → lifecycle + postmortem (MAE/MFE) | new; `candel` workspace |
| `av.execution.dispatch` | **execution** | yes | approved OrderIntent → gateway command | unified trading service |

Non-negotiables for all twelve: no skill may call a model provider directly (the
AI Router does that); no skill may write trade state except
`av.execution.dispatch`; every skill emits a JSON artifact with
`schemaVersion`, `skillId`, `skillVersion`, `inputsHash`, `generatedAt`.

---

## 8. Proposed architecture — "AlgoVault Intelligence Skills"

**Principle: a skill is a contract, not an engine.** It may compute, retrieve,
explain and propose. It may not bypass the risk engine, the policy engine or the
gateway, and it may not introduce a second backtester.

### 8.1 Layers

```
                    ┌──────────────────────────────────────────┐
  AI Router ───────►│  Skill Runtime (provider-independent)    │
  (lib/ai)          │  resolve → validate input → execute →    │
                    │  validate output → emit artifact + event │
                    └───────────────┬──────────────────────────┘
                                    │  (registered as tools)
                    ┌───────────────▼──────────────────────────┐
                    │  lib/agent/tools/registry.ts (existing)  │
                    │  evaluatePolicy → limits → execute       │
                    │  → redact → event log                    │
                    └───────────────┬──────────────────────────┘
             ┌──────────────────────┴───────────────────────┐
             │ RESEARCH SKILLS (pure)                       │ EXECUTION SKILLS
             │ overfit-audit, cv-split, regime-coverage,    │ dispatch
             │ cointegration, pre-trade-gate, breaker,      │
             │ sizing-kelly, cost-model, ict-doctrine,      │
             │ memory-thesis, ea-tester                     │
             └──────────────────────┬───────────────────────┘
                                    ▼
        OrderIntent ──► lib/risk/risk-engine.ts (canonical, unchanged)
                    ──► permission (`trade.execute.*`, confirmation, budget)
                    ──► unified trading service ──► MT5 gateway
```

### 8.2 Skills Registry

`lib/skills/registry.ts` + `lib/skills/manifests/*.ts`. A manifest is data, not
code paths:

```ts
interface SkillManifest {
  id: string;                 // "av.research.overfit-audit"
  version: string;            // semver — artifacts record it
  kind: "research" | "execution";
  title: string; summary: string;
  inputs: JSONSchema; outputs: JSONSchema;
  requires: readonly AgentPermission[];     // reuses the existing union
  deterministic: boolean;                   // false ⇒ output must be labelled advisory
  tokens: number;                           // context budget (velonone pattern)
  dependencies: readonly string[];          // skill ids, acyclic
  verification: {                           // tradermonty pattern
    unitTests: "passed" | "failed" | "not_verified";
    schemaContract: ...; goldenFixtures: ...;
    financialLogicReview: ...; empiricalValidation: ...;
  };
  costModel?: { source: "configured" | "realised"; updatedAt: string };
}
```

### 8.3 Execution contracts

* **Input validation** against the manifest schema before execution; reject with a
  structured `SKILL_INPUT_INVALID`, never coerce.
* **Output validation** against the output schema; the artifact carries
  `skillVersion`, `inputsHash` (deterministic replay) and `generatedAt`.
* **Failure is visible**: `UNAVAILABLE` / `INSUFFICIENT_DATA` outcomes are
  first-class results (skepsis pattern), never an empty success.
* **Advisory labelling**: any `deterministic: false` output is stored with
  `advisory: true` and cannot be consumed by an execution path.

### 8.4 Provider-independent agent instructions

Skill instructions live as versioned Markdown/JSON inside the manifest, consumed
by the AI Router exactly like any other prompt asset. No skill embeds a provider
name, model id or API key. The existing rule holds: OpenRouter free models are
discovered from the live catalog; Ollama is explicit-selection only; paid
inference is never auto-selected.

### 8.5 Existing-engine integration (no duplicates)

| Existing | How skills use it |
|---|---|
| AI Router (`lib/ai/router.ts`) | sole model access; skills never import a provider |
| Strategy Engine (`lib/strategy-engine`) | skills emit `StrategySpec`/parameters through `validation.ts`; no new backtester |
| Risk Engine (`lib/risk`) | sole order-intent authority; skills may only *subtract* permission (a breaker veto) |
| Backtesting pipeline | `av.research.overfit-audit` and `cv-split` are stages, not engines |
| MT5 Gateway | unchanged; `av.execution.dispatch` is the only skill allowed to emit commands |
| Market Intelligence | `av.ict.doctrine` supplies cited doctrine to existing detectors/panels |

### 8.6 Execution permissions

Extend — do not fork — `AgentPermission` with `trade.propose`,
`trade.execute.paper`, `trade.execute.live` (blocked by default, mirroring
`git_push` / `deployment`). `requiresConfirmation: true` on every execution
skill. Live additionally requires an explicit typed confirmation **and** a
`DailyBudget` and an armed kill switch check. The existing fail-closed rule
applies unchanged: missing permission information ⇒ DENY.

### 8.7 Versioning, audit, replay

* Manifest semver + `inputsHash` makes every artifact reproducible.
* Artifacts append to an audit path (RTDB, mirroring the gateway snapshot
  conventions) with `skillId`, `version`, `actor`, `mode`, `decision`.
* Reuse the existing redaction and the 24 000-char output cap in
  `tools/registry.ts`; skills must not bypass it.
* A skill version bump invalidates cached artifacts (same pattern as
  `strategy-engine/versioning.ts`).

### 8.8 Research vs execution separation

Hard, structural, and testable:

1. `kind: "research"` skills receive no execution permission, so `evaluatePolicy`
   denies any attempt to reach the gateway — no additional check required.
2. Research artifacts are append-only evidence; execution reads only
   `OrderIntent`, never a research artifact directly.
3. The only writer of trade state is `av.execution.dispatch`.
4. Any AI-authored field consumed downstream is `advisory` and re-validated
   deterministically.

---

## 9. Security and licensing blockers

| # | Blocker | Severity | Required action |
|---|---|---|---|
| 1 | **`pouriamrt/trading-live-claude` has no licence.** Its router/budget/kill-switch designs are the best patterns found, but the code is all-rights-reserved. | **Blocking for reuse** | Re-derive from the described behaviour; no code, comments or doc text copied. Record the derivation in `DECISIONS.md`. |
| 2 | **Mobius content provenance.** The repo is Apache-2.0, but the 2 008 cards are distilled from 300+ third-party videos and live lessons; upstream claims cannot be verified, and Chinese source labels are preserved. | **High** | Do not ingest wholesale. Curate a <60-card subset, re-write definitions in our own words, attribute to the public doctrine (ICT/Wyckoff literature), and keep `ATTRIBUTION.md` obligations. Legal review before shipping any card text. |
| 3 | **Mobius external dependency.** Fresh analysis requires `api.mobiusquant.ai`; pricing, SLA and upstream vendors are unverifiable from the repo. | High | Treat as unavailable. Our own detectors + our own data only. |
| 4 | **Mobius size.** 218 MB, 2 016 JSON files, `.npz` embeddings. | Medium | Never vendor; curated JSON subset only. |
| 5 | **`mt5-robot-tester` can hijack a live terminal** (documented by its author: INI has no `Login`, `ShutdownTerminal=1`). | **High** | Portable, tester-only install with an explicit `terminal64.exe` path; auto-detect disabled by default; never the live broker terminal. |
| 6 | **`mt5-trading-mcp` places real orders**, keeps consent previews in memory, and its audit log does not `fsync`. | High | Borrow the *policy shape* only (preflight, consent, idempotency, audit); never run it against an AlgoVault account. |
| 7 | **Prompt injection via skill content.** SKILL.md and retrieved case cards are text an agent will follow. Mobius case cards in particular are third-party quotations. | **High** | Treat all external skill text as data: strip imperative instructions, wrap retrieved content, keep `scope-guard` + redaction, and never let retrieved text select a tool. |
| 8 | **Python-only numerics.** statsmodels/ripser/numba/scipy do not run in the Next.js runtime. | Medium | Port the maths to TS (`dsr`, `pbo`, `kelly`, `ADF`, `Hurst`, `OU`), or isolate a research sidecar behind an internal API. No new runtime added to the app path. |
| 9 | **Paid data keys.** tradermonty/agiprolabs skills assume FMP/Polygon/Birdeye. | Medium | Use existing providers; skills must declare `costModel` and fail honestly when a key is absent. |
| 10 | **`JayLunia/trading-agent-skills` is a 1:1 fork.** | Low | Exclude from sourcing; never vendor or cite as independent evidence. |
| 11 | **Marketing/code drift.** `lib/tools-catalog.ts` sells Kelly and 1 000-path ruin Monte-Carlo that the codebase does not implement. | **Credibility** | Implement (P1) or remove the claim. Do not leave a paid feature list that the code cannot satisfy. |
| 12 | **Canned validation stages.** `market-intelligence/validation/pipeline.ts` reports `COMPLETED` without executing. | **Correctness** | Wire to the real engines or delete the module. |
| 13 | **LLM cost/behaviour in multi-agent designs** (TradingAgents): non-deterministic, research-only, historically prone to look-ahead bugs. | Medium | Concept only; if adopted, constrain by the existing AI Router budget and `provenance`. |

---

## 10. Prioritised implementation roadmap

Sequenced so that each phase makes the next one trustworthy. Effort is
engineering days, excluding review.

### P0 — credibility and safety (before any new product surface)

| # | Item | Effort | Exit criterion |
|---|---|---|---|
| 1 | `av.research.overfit-audit` (DSR, PSR, PBO/CSCV, MinTRL) as pure TS + fixtures | 3–4 | Optimiser output rejected when `PBO > 0.5` or `DSR < 0.95` in a fixture test |
| 2 | `av.research.cv-split` (purge + embargo) wired into the existing forward/OOS stages | 3–4 | No train/test label overlap in a property test |
| 3 | Fix `market-intelligence/validation/pipeline.ts` — real engines or removal | 1–2 | Stage results carry real artifact ids |
| 4 | `av.risk.account-breaker` (drawdown + losing streak + cooldown) as a pre-gate | 3–5 | Cannot increase approval; only vetoes |
| 5 | Trade permissions + typed confirmation + `DailyBudget` | 3–4 | Live remains blocked by default; budget enforced in a test |
| 6 | `av.risk.pre-trade-gate` fingerprint + batch validation | 2–3 | Duplicate intent rejected; jointly-breaching batch blocked |
| 7 | `lib/skills/` registry + manifest schema + verification matrix | 4–6 | Every skill resolvable, versioned, policy-evaluated |
| 8 | Freshness/evidence response contract enforced on market answers | 2–3 | No market answer without a `freshness` block |
| 9 | Resolve marketing drift (Kelly, ruin MC) | 1 | Catalog matches code |

### P1 — capability and differentiation

| # | Item | Effort |
|---|---|---|
| 10 | `av.risk.sizing-kelly` (half-Kelly, clamped under the risk-% ceiling) | 1–2 |
| 11 | `av.execution.cost-model` (realised slippage per symbol/session, configured vs realised UI) | 4–6 |
| 12 | `av.research.regime-coverage` (OOS segmented by regime) | 2–3 |
| 13 | `av.research.cointegration` (Engle-Granger, ADF, Hurst, OU half-life) → pairs strategies | 6–10 |
| 14 | `av.memory.thesis` (lifecycle + MAE/MFE postmortem) | 5–8 |
| 15 | `av.ict.doctrine` (curated, translated, attributed subset + citation UI) | 6–10 + curation |
| 16 | SMC parity harness against `pyvsmc` golden fixtures; resolve BOS/CHoCH policy | 5–8 |
| 17 | `av.mt5.ea-tester` (report/optimisation parsers, portable-terminal orchestration) | 10–15 |

### P2 — optional expansion

| # | Item | Effort |
|---|---|---|
| 18 | Breadth / distribution-day / market-top monitors | 5–8 |
| 19 | Weekly performance digest + exposure coach (event exposure) | 4–6 |
| 20 | VaR/CVaR in portfolio risk panel | 2–3 |
| 21 | Bull/bear debate orchestration on top of `lib/ai-trading-teams` (advisory only) | 5–8 |
| 22 | Tax-lot accounting (only if a tax surface ships) | 6–10 |

**Stop point:** this document is delivered for approval. No implementation has
begun; no AlgoVault code, schema, rule or configuration was modified.

---

## Appendix A — Evidence index

* Repos cloned and read (then deleted): `tradermonty/claude-trading-skills`,
  `agiprolabs/claude-trading-skills`, `Jakeschincariol/trader-skill`,
  `MobiusQuant/OpenMobius-skill`, `pouriamrt/trading-live-claude`,
  `velonone/MASTER-Trading-Skills`, `JayLunia/trading-agent-skills`,
  `Khaymat/pyvsmc`, `vincentwongso/mt5-trading-mcp`,
  `AgentJDrew/backtest-guard`.
* Key files cited: `skills/mt5-robot-tester/SKILL.md` +
  `scripts/parse_mt5_report.py`; `skills/backtest-expert/{SKILL.md,
  references/methodology.md}`; `skills/pre-trade-discipline-gate/SKILL.md`;
  `skills/drawdown-circuit-breaker/SKILL.md`; `skills/trader-memory-core/SKILL.md`;
  `skills-index.yaml`; `skills/walk-forward-validation/SKILL.md`;
  `trader-risk/{SKILL.md,check.py}`;
  `MobiusQuant/SKILL.md`, `knowledge_base/{index.json,concepts/fair_value_gap_rebalance.json,
  schemas/}`, `evals/`;
  `src/trading_live_claude/{execution/router.py,execution/daily_budget.py,
  risk/heat.py,risk/kill_switch.py,risk/sizing.py,risk/var.py}`;
  `velonone/{AGENT_MANIFEST.json,backtest/metrics.py,skills/signals/technical/kelly.py,
  skills/signals/topological/tda.py,tests/test_adversarial.py}`;
  `mt5_mcp/policy/{engine,preflight,consent,idempotency,audit}.py`;
  `backtest_guard/{dsr,pbo,purged_kfold,leakage}.py`;
  `pyvsmc/src/pyvsmc/{fvg,structure,order_blocks,liquidity,swings,zones}.py`.
* AlgoVault files cited: `lib/risk/risk-engine.ts`,
  `lib/agent/policies/permission-engine.ts`, `lib/agent/tools/registry.ts`,
  `lib/strategy-research/robustness.ts`, `lib/strategy-lab/{validation,forward,
  optimization}.ts`, `lib/strategy-engine/{simulation,metrics,versioning}.ts`,
  `lib/market-intelligence/validation/pipeline.ts`,
  `lib/market-intelligence/research/monte-carlo/runner.ts`,
  `lib/market-core/smart-money/*`, `lib/analytics/market-regime.ts`,
  `lib/cross-asset/regime.ts`, `lib/portfolio/monte-carlo.ts`,
  `lib/tools-catalog.ts`, `MQL5/AlgoVaultTradeGateway/AlgoVaultTradeGateway.mq5`.

## Appendix B — What this audit could not verify

* Whether any external test suite currently passes (dependencies were not
  installed, per the read-only rule).
* Actual star/fork counts for repos other than `tradermonty` (not captured).
* Mobius Quant API pricing, SLA and upstream data vendors — unreachable from the
  repository.
* `landtml/quantowl` licence (README inspected only) — must be checked before any
  use.
* How much of tradermonty's 74-skill surface actually *runs* end-to-end; only the
  MT5 tester, backtest evaluator and screener paths were read closely.
* AlgoVault's live MT5 execution semantics — out of scope here; the previous
  execution-safety concerns in `FEATURE_INVENTORY.md` stand unverified.
