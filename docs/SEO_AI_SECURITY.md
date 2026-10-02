# AlgoVault SEO, AI Search, LLM Discoverability & Security Layer Architecture

> **Notice**: No public web file can guarantee that a determined actor cannot copy publicly accessible content. Real protection comes from authentication, authorization, rate limiting, server-side controls, and infrastructure-level protections.

## 1. Executive Overview
This document outlines the architecture, data boundaries, discovery mechanisms, security protections, and testing standards for AlgoVault's integrated SEO, AI Search, LLM Discoverability, and Security Hardening layer.

The architecture ensures that both traditional search engines (Google, Bing) and next-generation AI search engines / answer agents (Perplexity, ChatGPT, Claude, Gemini, SearchGPT) can accurately discover, parse, comprehend, and cite official public AlgoVault information while strictly protecting private trading data, account balances, and backend infrastructure.

---

## 2. SEO Foundation & Sitemap Architecture

### A. Dynamic Native Robots (`app/robots.ts` & `public/robots.txt`)
- **Public Allowed Routes**: `/`, `/marketplace`, `/pricing`, `/docs`, `/insights`, `/compare`, `/broker-compare`, `/strategy-compare`, `/verified-performance`, `/economic-calendar`, `/signal-transparency`, `/store`, `/tools`, `/spreads`, `/mobile`.
- **Private Disallowed Routes**: `/admin`, `/account`, `/auth`, `/checkout`, `/api`, `/dashboard`, `/trade-journal`, `/trade-management`, `/trade-replay`, `/portfolio`, `/workflows`, `/strategy-lab`, `/risk`, `/goals`, `/alert-center`, `/reports`, `/execution-analytics`, `/equity-curve`, `/r/`, `/login`, `/register`, `/trading`.
- **Canonical Sitemap Link**: `https://algovault.app/sitemap.xml`.

### B. Production Sitemap Architecture (`app/sitemap.ts`)
The sitemap dynamically generates entries for:
1. Core static public marketing & comparison pages.
2. Public documentation methodology routes (`/docs/[slug]`).
3. Sanitized public marketplace product routes (`/marketplace/[id]`).

### C. Private Route Metadata Protection
Private layouts (`app/admin/layout.tsx`, `app/account/layout.tsx`, `app/dashboard/layout.tsx`) explicitly set:
```typescript
export const metadata: Metadata = {
  robots: { index: false, follow: false, noimageindex: true },
};
```
This guarantees that even if a crawler ignores `robots.txt`, search engines will not index private user pages.

---

## 3. Structured Data & Entity Optimization (JSON-LD)

AlgoVault employs Schema.org JSON-LD structured data to establish a single, machine-readable identity across the web:

1. **Organization Schema**:
   - `name`: "AlgoVault"
   - `legalName`: "AlgoVault Trading Technologies"
   - `url`: "https://algovault.app"
   - `logo`: "https://algovault.app/logos/logo.png"

2. **WebSite Schema**:
   - Provides SearchAction potentialAction pointing to `https://algovault.app/marketplace?q={search_term}`.

3. **SoftwareApplication Schema**:
   - Classifies AlgoVault under `FinancialApplication` for Web, MT5, iOS, Android, and Desktop.

4. **BreadcrumbList & Article Schemas**:
   - Integrated into the Public Documentation Hub (`app/docs/page.tsx` and `app/docs/[slug]/page.tsx`).

---

## 4. AI Discoverability & Knowledge Architecture

AlgoVault provides machine-readable public text files optimized for LLM context windows, AI search engines, and autonomous browser agents:

1. **`/llms.txt`**: Concise public platform summary, primary capabilities, target audience, and canonical link list.
2. **`/llms-full.txt`**: Comprehensive public knowledge base explaining Smart Money Concepts, Scalping Terminal architecture, 4-phase backtest validation pipeline, and responsible data boundaries.
3. **`/ai-search.txt`**: Key-value structured entity file designed for AI answer engines and research agents.
4. **`/ai-agent.txt`**: Guidelines for autonomous AI agents, highlighting allowed public endpoints vs. restricted private areas.
5. **`/ai.txt`**: Plaintext crawling and citation policy declaration.

---

## 5. Public Documentation Hub (`/docs`)

To make AlgoVault's technical methodologies authoritative citation targets for AI answer engines, public specifications from `docs/` are served at `/docs`:
- **`/docs`**: Document index grouped by category (Market Intelligence, Trading Engines, Research & Backtesting, Integrations).
- **`/docs/[slug]`**: Dynamic documentation view with clean typography, BreadcrumbList JSON-LD, Article JSON-LD, and copyable canonical citation links.

---

## 6. Security Hardening, Anti-Cloning & API Access Classification

### A. HTTP Security Headers (`next.config.ts`)
All server responses carry defense-in-depth HTTP headers:
- `Strict-Transport-Security`: `max-age=31536000; includeSubDomains; preload`
- `X-Content-Type-Options`: `nosniff`
- `X-Frame-Options`: `SAMEORIGIN`
- `Referrer-Policy`: `strict-origin-when-cross-origin`
- `Permissions-Policy`: `camera=(), microphone=(), geolocation=(), interest-cohort=()`

### B. Server-Side Rate Limiting (`lib/security/rate-limiter.ts`)
- Sliding window token bucket rate limiter tracking requests per IP identifier.
- Enforces strict execution limits on public and API routes to prevent scrapers and automated bot attacks.

### C. API Access Classification (`lib/security/api-classifier.ts`)
Classifies every API route into authorization levels:
- `PUBLIC`: Webhook receivers, public data views.
- `AUTHENTICATED`: User profile, trading terminal, private signals.
- `ADMIN`: Platform administration and management.
- `CRON`: Scheduled system tasks (protected by `x-cron-secret`).

---

## 7. Developer Validation & Testing

### A. Automatic Validator (`scripts/validate-seo-ai.ts`)
Command: `npm run validate:seo-ai`
- Checks for presence and syntax of all SEO, AI knowledge files, and security declarations.
- Scans files to ensure zero secrets (`sk_live_`, `FIREBASE_PRIVATE_KEY`, service account credentials) are present.

### B. Unit & Integration Tests (`tests/run-seo-security-tests.ts`)
Command: `npm run test:seo-ai`
- Verifies rate limiter bucket behaviors under burst load.
- Validates API classification mappings.
- Confirms public documentation retrieval and slug resolution.

---

## 8. Deployment Requirements & Cloudflare Hardening

1. **Environment Variables**: Ensure `NEXT_PUBLIC_APP_URL` is set to `https://algovault.app` in production.
2. **Cloudflare WAF (Optional Recommendation)**:
   - Enable Cloudflare Bot Management / Super Bot Fight Mode.
   - Configure Rate Limiting rules on `/api/*` endpoints to match application-level limits.
   - Enable DNSSEC and HSTS preload at the Cloudflare edge.
