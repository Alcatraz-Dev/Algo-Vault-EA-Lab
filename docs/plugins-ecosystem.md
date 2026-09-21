# Plugins & Extensions Ecosystem — Technical Documentation

This document describes the Plugins & Extensions Ecosystem built on top of the
existing AlgoVault architecture (Next.js 16, Firebase Realtime Database, Stripe,
Telegram/Discord, notifications, AI gateway). It is **additive**: it reuses the
existing auth, admin, payment, notification and market-data plumbing rather than
replacing it.

---

## 1. What is a plugin?

A plugin is a **background intelligence agent** that runs server-side on a
schedule and produces analytical findings and alerts. It is NOT a bot, signal,
backtest, calculator, indicator or chart — it adds new capabilities on top of
those.

Two kinds of records exist in the catalog (`plugins/{id}`):

| Kind | Purpose |
| --- | --- |
| `plugin` | Background analyzer (market monitoring, risk guard, news watch, AI summaries…). |
| `extension` | Connector for outside tools — browser, TradingView companion, webhook, Discord, Telegram, API. |

Extension installations are stored separately under `extensionInstallations/{userId}`.

---

## 2. Lifecycle

### Catalog status (per plugin record)

```
draft → testing → pending_review → published → disabled
```

- **draft / testing / pending_review** — hidden from the marketplace.
- **published** — visible, installable, schedulable.
- **disabled** — hidden; existing installations stop scheduling.

### Installed lifecycle (per user installation)

```
installed → configured → active ⇄ paused → disabled → uninstalled
```

- `installed` — the record is attached to the user.
- `configured` — the user saved a configuration.
- `active` — the server-side scheduler runs it on the configured interval.
- `paused` — scheduling suspended, configuration kept.
- `disabled` — user disabled the plugin (can be re-activated).
- `uninstalled` — removed; can be reinstalled.

### Managing lifecycle

- **Users** drive the installed lifecycle from `/account/plugins` and
  `/account/plugins/[id]` (`/api/plugins/[pluginId]/state` — actions
  `activate | pause | resume | disable`, plus `execute` and `uninstall`).
- **Admins** drive the catalog lifecycle from `/admin/plugins/[id]`
  (`PUT /api/admin/plugins/[id]` with `{ status }`), bump versions
  (`{ action: "version", version, changelog }`) and watch the audit log
  (`GET /api/admin/plugins/[id]`).

---

## 3. Manifest & permissions

Every catalog record carries a `PluginManifest`:

```ts
{
  name, displayName, version,
  type, category,
  pricing: { type: "free" | "one_time" | "subscription", price, currency, intervalMonths? },
  permissions: PermissionSet,
  subscribes: string[], emits: string[],
  runtime: {
    handler?: string,           // registered built-in analyzer (built-in plugins)
    interval: PluginInterval,   // 10s … daily, market_open/close, event, manual
    timeoutMs: number,
    sources: string[],          // declarative data sources
    requires: string[],         // declared sandbox APIs (generated plugins)
    condition?: DeclarativeCondition,  // generated plugins only
  }
}
```

### Hard safety boundary

The runtime grants access to data and services ONLY through declared
permissions (`lib/plugins/permissions.ts`). The following are **never**
grantable and block validation:

- `trading_execution`, `order_placement` — plugins do not place orders.
- `account_credentials`, `payment_information` — never touched.
- `database_access`, `arbitrary_server_execution` — no arbitrary code.

Built-in plugins use a **registered analyzer function** (e.g. `risk_guardian`).
Generated plugins use a **declarative condition tree** evaluated server-side —
they never contain executable code.

---

## 4. Runtime & scheduler

- Scheduling lives in `/api/plugins/runtime/tick` (Vercel cron `* * * * *`,
  guarded by `PLUGIN_RUNTIME_CRON_SECRET`). Each tick pulls the set of due
  installations from `pluginRuntimeState` and runs them via
  `lib/plugins/runtime/engine.ts`.
- Executions are non-destructive: they read market/risk/news/strategy snapshots,
  evaluate the plugin's handler or condition, and emit findings + alerts.
- Results are stored per user: `pluginExecutions/{userId}/{pluginId}`,
  `pluginLogs/{userId}/{pluginId}`, `pluginEvents/{userId}`.
- Test runs (`trigger: "test"`) are sandboxed: alert delivery is suppressed and
  a scratch execution path is used. Admins run these from
  `/admin/plugins/[id]` → Sandbox test (`POST /api/admin/plugins/[id]/test`).

---

## 5. Notification hub

`lib/plugins/runtime/notification-hub.ts` enforces per-tenant delivery policy
before dispatching:

- **Cooldown** (`cooldownMin`) between alerts per plugin.
- **Quiet hours** (`quietHoursStart`/`quietHoursEnd`).
- **Max alerts per day** (`maxAlertsPerDay`, bucketed by UTC day).
- **Duplicate suppression** via a dedupe key per event type.
- **Severity** (`low | medium | high`) drives tone and priority.

Delivery reuses the existing `notifyUser` plumbing (in-app, email, Telegram,
Discord, webhook). Every delivered alert is recorded under
`pluginNotifications/{userId}` and shown in the account → Logs tab and the
existing notification hub.

---

## 6. Licensing & Stripe

- Free plugins install instantly via `/api/plugins/install`.
- Paid plugins reuse the existing checkout: `/api/checkout/create` accepts an
  `orderType: "plugin"` branch (`productType: "plugin"` + `pluginId` on the
  marketplace details page), creates a Stripe Checkout Session, and the
  `success_url` returns to `/account/plugins?payment=success&order=...`.
- The Stripe webhook writes a **plugin license** at
  `pluginLicenses/{userId}/{pluginId}` (`status: active|expired|revoked|past_due`,
  subscription id when applicable).
- `licensing.ts` validates license state before activation; expiration/revocation
  flips installations to disabled.

---

## 7. AI Plugin Studio

`lib/plugins/ai-generator.ts` implements the safe pipeline on top of the shared
AI gateway (`lib/ai`):

```
prompt → structured spec → normalize → validate → sandbox test → draft
```

- The generator only emits **declarative** plugins against
  `SUPPORTED_RUNTIME_APIS` (`market_monitor`, `price_signal`, `risk_limits`,
  `news_calendar`, `notifications`, `scheduler`, `trade_history`,
  `strategy_context`).
- Anything the prompt asks for outside that surface is written to
  `unsupportedCapabilities` with an honest `suggestedImplementation` and blocks
  publishing — never faked.
- Pipeline checks: `schema`, `permissions`, `security`, `sandbox`, `tests`
  (condition evaluated against synthetic market contexts).
- Extensions are generated the same way: choose target `extension` + a
  connection type (`browser`, `tradingview`, `webhook`, `discord`, `telegram`,
  `api`). `extensionType` is carried through the spec → draft → record, so
  published extensions are never mislabeled. Drafts land in `pluginDrafts/{id}`;
  jobs in `pluginGenerationJobs/{id}`.
- Admins review, then either publish to the marketplace:
  - plugins → `POST /api/admin/plugins` with `{ fromDraft, publishNow: true }`
  - extensions → `POST /api/admin/extensions` with `{ fromDraft, publishNow: true }`
  - or save as a catalog draft (`publishNow: false`).

Admin UI: `/admin/plugins/ai-studio`. The admin plugin detail page
(`/admin/plugins/[id]`) adds status transitions, version bumps, metadata edits,
sandbox tests and the audit log.

---

## 8. Admin surfaces

| Page | Purpose |
| --- | --- |
| `/admin/plugins` | Catalog summary, records table, seed built-in catalog, links. |
| `/admin/plugins/create` | Register a plugin or extension manually (use `?type=extension` to pre-select extensions). |
| `/admin/plugins/[id]` | Lifecycle, version bump, metadata edit, sandbox test, audit. |
| `/admin/plugins/ai-studio` | Generate, validate, review and publish AI drafts (plugins + extensions). |
| `/admin/extensions` | Extension records list, plus "New Extension" and "AI Generate" entry points. |

Seeding the 10 built-in plugins + 5 extensions is an admin-gated idempotent
route: `POST /api/admin/plugins/seed`. Nothing writes catalog data implicitly at
startup — the catalog is empty until an admin seeds it.

---

## 9. Realtime Database layout (plugins)

| Path | Owner |
| --- | --- |
| `plugins` | public read; admin write |
| `pluginCategories` | public read; admin write |
| `pluginInstallations/{userId}` | user read/write |
| `pluginConfigs/{userId}` | user read/write |
| `pluginRuntimeState/{userId}` | user read; runtime (admin) write |
| `pluginRuntimeStateIndex/{userId}` | user read; runtime (admin) write |
| `pluginExecutions/{userId}` | user read; runtime (admin) write |
| `pluginLogs/{userId}` | user read; runtime (admin) write |
| `pluginEvents/{userId}` | user read; runtime (admin) write |
| `pluginNotifications/{userId}` | user read; runtime (admin) write |
| `pluginAlertState/{userId}` | user read; runtime (admin) write |
| `pluginAlertCounts/{userId}` | user read; runtime (admin) write |
| `pluginLicenses/{userId}` | user read; webhook/admin write |
| `extensionInstallations/{userId}` | user read/write |
| `pluginReviews/{pluginId}` | public read; signed-in write |
| `pluginDrafts` | admin only |
| `pluginGenerationJobs` | admin only |
| `pluginAuditLogs` | admin only |

These rules are declared in `database.rules.json` (deploy with
`firebase deploy --only database`). All server-side code uses the Firebase Admin
SDK and is unaffected by client rules.

---

## 10. Environment

See `.env.exemple`:

- `PLUGIN_RUNTIME_CRON_SECRET` — shared secret for the scheduler cron endpoint.
- The AI Plugin Studio uses the existing AI gateway keys (`GEMINI_API_KEY`,
  `OPENROUTER_API_KEY`, etc.). A paid provider is recommended for production so
  generation is not throttled.

---

## 11. Deployment checklist

1. `vercel.json` already adds the `/api/plugins/runtime/tick` cron.
2. Set `PLUGIN_RUNTIME_CRON_SECRET` in Vercel/production.
3. Deploy `database.rules.json` (`firebase deploy --only database`).
4. As an admin, open `/admin/plugins` → **Seed built-in catalog**.
5. Publish records that should be visible in the marketplace; test generated
   drafts in the AI Studio before publishing.