# AlgoVault — Resources & Licenses

Verified inventory of repositories, libraries, products, integrations, research, and design references relevant to AlgoVault. For each entry: official URL, purpose, relevant features/ideas, license + usage restrictions, compatibility, security/maintenance, estimated adoption cost, and final classification (adopted / rejected / deferred / inspiration only).

> **Rule:** Do not add dependencies merely because they are popular. Do not copy source code without verifying its license and obligations. Keep competitor research separate from implementation facts.

---

## Trading terminals / chart UX reference

| Resource | URL | Purpose | Relevance | License | Compatibility | Security / maintenance | Adoption cost | Classification |
|---|---|---|---|---|---|---|---|---|
| TradingView | https://www.tradingview.com/ | Charting benchmark: interactions, visual hierarchy, TA workflows, architecture | Benchmark only; no proprietary charting lib / redistribution rights assumed | Proprietary (library docs) | Does not cover cloning or redistribution | Data rights + integration requirements must be verified before adoption | Low (study only), if adopted | **Inspiration only** |
| OpenDots & UI concepts | https://opendots.google/ (or equivalent) | Interface/interaction patterns adaptable to AlgoVault | Review for adaptable patterns | Verify original project + license | — | — | Low | **Inspiration only** |

---

## Trading integration / architecture

| Resource | URL | Purpose | Relevance | License | Compatibility | Security / maintenance | Adoption cost | Classification |
|---|---|---|---|---|---|---|---|---|
| OpenAlgo | https://openalgo.in/ | Broker adapters, execution abstractions, charting components | Study patterns; do not assume license uniformity | Verify per-component | Historical note distinguishes OpenAlgo Charts (Apache-2.0) from core (AGPL-3.0) — must recheck current repo licenses | License is component-specific; verify before reuse | To verify | **Deferred — license recheck required** |
| MQL5 / MetaTrader 5 | https://www.mql5.com/ | Trading gateway/EAs (`MQL5/AlgoVaultTradeGateway`) | Core trading integration | Proprietary platform | Required for our gateway/EAs | Server-side secret + execution safeguards are our responsibility | N/A (own code) | **Adopted (core)** |

---

## AI UX / copilot patterns

| Resource | URL | Purpose | Relevance | License | Compatibility | Security / maintenance | Adoption cost | Classification |
|---|---|---|---|---|---|---|---|---|
| CopilotKit | https://www.copilotkit.ai/ | AI-assisted UX, contextual assistance, app-aware interactions | Study AI UX patterns | Verify repo license | Do not assume architecture should replace Candlel's engine | — | To verify | **Inspiration only** |

---

## ERP / accounting

| Resource | URL | Purpose | Relevance | License | Compatibility | Security / maintenance | Adoption cost | Classification |
|---|---|---|---|---|---|---|---|---|
| ERPNext | https://erpnext.com/ | Accounting/ERP optional integration | Optional accounting/ERP | AGPL-3.0 (repo) | Optional by default; disabled until verified | Third-party sync + credentials must be server-side + reviewed | To verify | **Deferred — disabled until verified** |

---

## Platform / infra

| Resource | URL | Purpose | Relevance | License | Compatibility | Security / maintenance | Adoption cost | Classification |
|---|---|---|---|---|---|---|---|---|
| Firebase | https://firebase.google.com/ | Auth + RTDB + hosting/emulator | Core persistence + auth | Proprietary (free tier) | RTDB only — no Firestore | Security rules + secret management are in scope | N/A (core) | **Adopted (core)** |
| Stripe | https://stripe.com/ | Subscriptions, licensing, Connect, webhooks | Core payments | Proprietary (API) | Webhook signature + idempotency in our code | Secret management server-side | N/A (core) | **Adopted (core)** |
| Twelve Data | https://twelvedata.com/ | Market data REST (primary) | Market data | Per-tier | Primary REST provider | Key stored server-side; rate limits handled | Free tier + add-on | **Adopted (core)** |
| RealMarket API | https://realmarketapi.com/ (or equivalent) | Live market data | Market data | Verify | Core live data | Server-side key | To verify | **Adopted (core)** |
| Biquote | https://biquote.com/ (or equivalent) | Realtime + signal ingestion | Realtime + signals | Verify | Core | Server-side; encryption at rest for OAuth tokens | To verify | **Adopted (core)** |
| Telegram (MTProto) | https://core.telegram.org/ | Signal ingestion + user alerts | Instant/notification | Telegram API | Token/Bot + API id/hash | Never expose tokens to client | N/A (third-party) | **Adopted (core)** |

---

## AI model providers (gateway)

| Resource | URL | Purpose | Relevance | License | Compatibility | Security / maintenance | Adoption cost | Classification |
|---|---|---|---|---|---|---|---|---|
| Gemini (Google) | https://ai.google.dev/ | AI provider | Gateway | Google terms | Optional | Key server-side only | To verify | **Optional** |
| OpenRouter | https://openrouter.ai/ | Multi-model routing | AI Router | Verifiable terms | Optional | Key server-side only | To verify | **Optional** |
| OpenCode | https://opencode.ai/ | Code/co-pilot model | AI Router | Verify | Optional | Key server-side only | To verify | **Optional** |
| B.AI | https://api.b.ai/ | AI provider | AI Router | Verify | Optional | Key server-side only | To verify | **Optional** |
| Bytez | https://api.bytez.com/ | Token/generative model | AI Router | Verify | Optional | Key + credit model | To verify | **Optional** |

---

## UI / design system

| Resource | URL | Purpose | Relevance | License | Compatibility | Security / maintenance | Adoption cost | Classification |
|---|---|---|---|---|---|---|---|---|
| Tailwind CSS v4 | https://tailwindcss.com/ | Utility-first CSS | Design system | MIT | v4 (`@import "tailwindcss"`) | — | Low | **Adopted** |
| Radix UI | https://www.radix-ui.com/ | Dialogs, dropdowns, tabs, tooltip (headless) | Shared components | BSD/Apache | Already in uses | — | Low | **Adopted** |
| Phosphor Icons | https://phosphoricons.com/ | Iconography | Shared icons | Free/commercial | React + React Native | — | Low | **Adopted** |
| Lucide | https://lucide.dev/ | Iconography | Shared icons | ISC | React | — | Low | **Adopted** |
| Recharts | https://recharts.org/ | Charts (declarative) | Dashboard widgets | MIT | React | — | Low | **Adopted (if needed)** |
| Lightweight Charts | https://github.com/tradingview/lightweight-charts | Native chart engine | Pro terminal + shared charts | TradingView (proprietary) | Verified in repo; no redistribution | Data rights + integration must be verified | Low (existing dep) | **Adopted (core)** |
| design-tokens (local) | `packages/design-tokens` | `@algovault/design-tokens` | Source of truth | Custom (local) | Web + planned RN | — | Maintained in-repo | **Adopted (core)** |

---

## Contribution / agent tooling

| Resource | URL | Purpose | Relevance | License | Compatibility | Security / maintenance | Adoption cost | Classification |
|---|---|---|---|---|---|---|---|---|
| AGENTS.md (auto-generated) | repo root | Next.js agent rules block | In-repo | N/A (generated) | Do not remove; commit because it is part of the app template | — | — | **Adopted** |
| ALGOVAULT_AGENT_CONSTITUTION.md | repo root | Product constitution, 1618 lines | Canon | Custom | Keep | — | — | **Adopted (canon)** |
| ALGOVAULT_PROJECT_MEMORY.md | repo root | Single source of truth for agents | Canon | Custom | Keep; update after session | — | — | **Adopted (canon)** |

---

## Security / ops tooling

| Resource | URL | Purpose | Relevance | License | Compatibility | Security / maintenance | Adoption cost | Classification |
|---|---|---|---|---|---|---|---|---|
| ESLint + eslint-config-next | https://eslint.org/ | Linting | Enforce code quality | MIT | v9 + Next 16 | — | Low | **Adopted** |
| Vitest | https://vitest.dev/ | Unit testing | Test runner | MIT | v5 | — | Low | **Adopted** |
| Playwright | https://playwright.dev/ | E2E browser testing | Viewport smoke suite | MIT | Used in `e2e/` | — | Low | **Adopted (if browser installed)** |

---

## Classified rules for this project's repo

1. **Adopted** = in active use, no license concern, low overhead, worth keeping/expanding.
2. **Rejected** = explicitly not adopted (none yet).
3. **Deferred** = adopted only after verify-a-condition (e.g., OpenAlgo license recheck, ERPNext sync verification).
4. **Inspiration only** = studied for patterns/UX; not adopted as code/library.
5. **Never reuse** without verifying the component's license, especially when the project has a multi-license or ALv2/AGPL situation (OpenAlgo precedent).
