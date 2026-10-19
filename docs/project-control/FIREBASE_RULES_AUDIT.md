# AlgoVault — Authentication, Access Control & Firebase Rules Audit

**Audit scope:** Section C (B-009 Admin/Pro gating, B-010 Firebase security & cache coherence).
**Audit date:** 2026-10-10. **RTDB rule re-verification:** 2026-10-19 (Bot Studio + entitlement pass).
**Scope note:** the Firebase Emulator is now exercised locally — `firebase` CLI + a JDK 21+ are enough; `npm run test:rtdb-rules` boots the Realtime Database and Auth emulators against the committed `database.rules.json` and asserts the authorization boundaries (owner isolation, entitlement protection, command injection, non-Pro denial). The application-layer guards are exercised against the in-memory fakes by `npm run test:security` and `npm run test:security:bot-studio`. **Production rules are still a separate question:** the live instance was inspected read-only and is running an OLDER ruleset than the one in this repository (see §7).

## 1. Route inventory and application-layer authorization

All routes are Next.js App Router route handlers under `app/api/*`. Each sensitive route reads the `Authorization: Bearer <idToken>` header and calls `authenticate()` (Firebase `adminAuth.verifyIdToken`), which derives the caller's identity server-side from the verified token. The server **never** trusts a body-supplied `userId`, `uid`, `role`, or `accountId` for authorization decisions; identity is fixed by the verified token.

### Authentication helpers (`lib/admin-auth.ts`)

| Helper | Server identity source | Rejects |
|---|---|---|
| `authenticate(request)` | `Authorization: Bearer <idToken>` → `adminAuth.verifyIdToken` | Missing/invalid/expired token (returns null) |
| `requireAdmin(request)` | `authenticate` + `users/{uid}/role === "admin"` | Non-admin, unknown uid |
| `isAdminUid(uid)` | `users/{uid}/role` RTDB read | N/A (pure role check) |
| `requireAdminOrProductOwner(req, productId?)` | `authenticate` + admin role **or** `bots/{productId}/ownerUid === token.uid` | Others |

### Trading authorization boundary (`lib/gateway.ts` → `lib/admin-auth.ts`)

| Helper | Server identity / entitlement source | Rejects |
|---|---|---|
| `verifyGatewayToken(token)` | `gateway_users/{token}/userId` RTDB read | Unknown/stale token |
| `hasActiveTradingLicense(userId)` | `trading_access/{userId}/*` (active + expiresAt) **or** `licenses/{userId}/*` type=custom_bot active | Expired, revoked, unknown |

This is the canonical "identity is verified server-side, entitlements are authoritative" boundary. Custom-bot entitlement (active Pro subscription without hard expiry) is accepted here, and the gateway register/heartbeat accept it too — so a queued EA order is never rejected by an over-strict license gate.

### Evidence of server-side derivation (not client-supplied)

- `/api/trading/execute` builds the input as `userId: token.uid` (server-derived) and resolves `accountId` server-side from the verified identity's own RTDB branch.
- `/api/trading/orders` resolves `accountId` from the verified user's RTDB branch, not the body.
- All `/api/admin/*` routes first call `verifyAdmin`/`requireAdmin` and return 401/403 before any privileged mutation.

## 2. Firebase RTDB rules — path-by-path status

`database.rules.json` is committed and describes the **checked-in** rules. `auth != null` requires a signed-in user; `auth.token.admin === true` requires a verified admin token; `root.child('users').child(auth.uid).child('role').val() === 'admin'` re-derives role client-side for convenience (insecure by itself, hence the explicit `auth.token.admin` path takes precedence).

### Deny-by-default root (correct)

```
.read: false
.write: false
```

All domain paths are narrower descendants.

### Paths authoritative for trading (B-009/B-010)

| RTDB path | .read | .write | Server-side equivalent | Notes |
|---|---|---|---|---|
| `tradingUnifiedAccounts/{userId}` | `auth.uid === $userId \| admin` | `admin` | `saveUnifiedAccount` (Admin SDK) | Server-only writes |
| `tradingExecutionRequests/{userId}` | `auth.uid === $userId \| admin` | `admin` | `claimExecutionRequest` (Admin SDK) | Idempotency is server-side |
| `tradingExecutionResults/{userId}` | `auth.uid === $userId \| admin` | `admin` | `saveExecutionResult` (Admin SDK) | Never client-written |
| `tradingAudit/{userId}` | `auth.uid === $userId \| admin` | `admin` | `appendAuditEvent` (Admin SDK) | No secrets, server-only |
| `trading_access/{userId}` | `auth.uid === $userId` | `admin` | app-layer (`hasActiveTradingLicense`) | License state is authoritative; clients cannot edit it |
| `trading_accounts/{userId}` | `auth.uid === $userId \| admin` | `admin` | gateway register/heartbeat (Admin SDK) | Server-only writes |
| `trading_positions/{userId}` | `auth.uid === $userId \| admin` | `admin` | gateway snapshot (Admin SDK) | Server-only writes |
| `trading_orders/{userId}` | `auth.uid === $userId \| admin` | `admin` | gateway snapshot (Admin SDK) | Server-only writes |
| `trading_order_requests/{userId}` | `auth.uid === $userId \| admin` | `admin` | gateway command queue (Admin SDK) | Command state is authoritative |
| `trading_history/{userId}` | `auth.uid === $userId \| admin` | `admin` | gateway snapshot (Admin SDK) | Server-only writes |
| `trading_logs/{userId}` | `auth.uid === $userId \| admin` | `admin` | gateway execution (Admin SDK) | Server-only writes |
| `trading_controls/{userId}` | `auth.uid === $userId \| admin` | `admin` | app-layer | Server-only writes |
| `tradingviewMcp/{userId}` | `auth.uid === $userId` | `false` | app-layer | Read-only client; writes server-only |
| `orders/{userId}` | `auth.uid === $userId` | `admin` | Marketplace orders | Server-only writes |
| `licenses/{userId}` | `auth.uid === $userId` | `admin` | app-layer license sync (Admin SDK) | Server-only writes |
| `subscriptions/{userId}` | `auth.uid === $userId` | `admin` | Stripe webhook (Admin SDK) | Server-only writes |
| `users/{uid}` | `auth.uid === $uid \| admin` | `auth.uid === $uid \| admin` | App-layer on signup; admin can touch | **Owner may write their own profile, but `subscription`, `developerSubscription`, `developerPlan`, `developerApproved`, `developerStatus` and `stripeConnect` are server-only, and `role` cannot be self-escalated to `admin` (see §2.1)** |

### Paths NOT covered by the audit (no deployed rule)

These paths are written by Admin SDK code but had no committed rule, so with the deny-by-default root every client read was refused. The server still writes here (owner-scoped).

| RTDB path | Comment | Status |
|---|---|---|
| `alerts/{userId}` | Owner-scoped; written by app/api/alerts via Admin SDK | Resolved by rule (owner-read, admin-write) |
| `monitoring/setups/{userId}` | Owner-scoped; written by repository via Admin SDK | Resolved by rule (owner-read, admin-write) |

No live production rules exist for the new `tradingUnifiedAccounts` / `tradingExecutionRequests` / `tradingExecutionResults` / `tradingAudit` paths. The same pattern as the above two: the rule must be added with owner-read + admin-write (server writes) semantics.

### 2.1 Bot Studio trees — server-authoritative by design

`database.rules.json` cannot carry inline comments (the RTDB rules parser rejects any non-rules key, including `"_comment"`), so the rationale for each server-authoritative tree lives here.

| RTDB path | Client `.read` | Client `.write` | Writer | Why |
|---|---|---|---|---|
| `bot_strategies/{strategyId}` | `false` | `false` | Admin SDK (`lib/bot-studio/database.ts`) | A strategy is private to its author. Clients read their own strategies **only** through `GET /api/bot-studio/strategies`, which filters by `authorId`. |
| `bot_deployments/{botId}` | `false` | `false` | Admin SDK | A deployment carries the owner's MT5 account, runtime state and live counters. Only the owning user (or an admin) may read it, and only via the API routes. |
| `bot_logs/{botId}/{logId}` | `false` | `false` | Admin SDK | Execution logs may contain strategy internals. |
| `bot_signals/{botId}/{signalId}` | `false` | `false` | Admin SDK | Signals are produced by the runtime, never by a client. |
| `bot_executions/{botId}/{execId}` | `false` | `false` | Admin SDK | The execution/command record. A client that could write here could forge or replay a command. |
| `bot_audit/{botId}/{auditId}` | `false` | `false` | Admin SDK | Immutable audit trail. |
| `bot_strategies_index/{authorId}` | owner only | `false` | Admin SDK | Owner's strategy index. Owner-readable so a client can resolve its own ids; server-written so the index cannot be poisoned. |
| `bot_deployments_index/{ownerId}` | owner only | `false` | Admin SDK | Same shape for deployments. |

Other server-authoritative trees carrying the same rationale: `performanceArena` (balances, results, rewards, leaderboard, fraud flags — never client-writable), `alerts/{userId}` and `monitoring/setups/{userId}` (owner-readable, server-written), `deviceWorkspace` and `userPreferences` (owner-readable so every surface — desktop, PWA, native — renders the same state, but **never** client-writable so the server can bump `revision` and resolve conflicts deterministically), and `mobileDevices` (server-only in both directions; it records `deviceId`, platform, app version and last-seen for admin observability and conflict attribution).

## 3. Admin SDK bypass analysis

Where the Admin SDK writes directly, RTDB rules are bypassed and application-layer authorization is the only gate. Confirmed by the audit above:

- **Trading execution:** `claimExecutionRequest` writes `tradingExecutionRequests` and `saveExecutionResult` writes `tradingExecutionResults`. Both require `hasActiveTradingLicense` + demo mode + idempotency — an unverified client can never call these.
- **Trading account snapshot:** `trading_accounts/{userId}` is written only by gateway register/heartbeat (Admin SDK). A client it does not touch.
- **License/entitlement state:** `licenses/{userId}` and `subscriptions/{userId}` are written only by server-side Stripe webhook handling; clients call `/api/stripe/webhook` which verifies the Stripe signature before any mutation.
- **Bot Studio (added 2026-10-19):** every Bot Studio route reads and writes through the Admin SDK, so *no* RTDB rule protects a Bot Studio record. Ownership is enforced in the route layer by `canAccessStrategy` / `canAccessDeployment` (`lib/bot-studio/auth.ts`), and entitlement by `requireBotStudioAccess` → `hasActiveProEntitlement` (`lib/bot-studio/entitlements.ts`), which re-reads the **server-authored** `users/{uid}/subscription` record. Route-level negative tests: `npm run test:security:bot-studio`.

**Conclusion:** There is no path where an unauthenticated or non-admin client can write a protected record. Cache coherence (`deviceWorkspace`, `userPreferences`) is owner-readable and server-only writable via the mobile API.

## 4. Confirmed findings grouped by severity

### P0 — Critical / exploitable

**P0-1 (2026-10-19) — Client-writable entitlement and role under `users/{uid}`.** The owner write rule on `users/{uid}` let any signed-in client write their own `subscription` / `role` fields, because the Admin SDK (and therefore `hasActiveProEntitlement` and `requireAdmin`) trusts exactly those records. A client could therefore (a) grant itself Pro/Enterprise, and (b) set `role: "admin"` and thereby pass `requireAdmin` on every admin route. **Confirmed by runtime emulator test** (see §7): with the pre-fix ruleset, 10 of 47 assertions fail, including a live rewrite of `users/{uid}/subscription` to `{"plan":"enterprise","status":"active"}` and a successful self-write of `role: "admin"`. **Fixed** by server-only `.validate` rules on the entitlement/role fields of `users/{uid}`; the same suite now passes 47/47.

**P0-2 (2026-10-19) — Bot Studio deployment listing leaked every user's deployments.** `GET /api/bot-studio/deployments` returned `listAllDeployments()` unfiltered, so any Pro user received every deployment in the system (owner id, MT5 account, runtime state, counters). The sibling strategies route already filtered by `authorId`; the deployments route did not. **Fixed** by filtering on `ownerId` for non-admins; regression test in `npm run test:security:bot-studio` (verified to fail against the pre-fix code).

**P0-3 (2026-10-19) — Strategy routes lacked ownership checks.** `PATCH`, `POST` (duplicate) and `DELETE` on `/api/bot-studio/strategies/{strategyId}` and the backtest route performed Admin-SDK writes with no `authorId` comparison, so any Pro user could rename, duplicate, backtest (which mutates the record) or delete another user's private strategy. **Fixed** with `canAccessStrategy`; non-owners now get 404 (the resource is not confirmed to exist).

### P1 — High-impact (candidate remediations, not confirmed exploits)

1. **Offline rule gap for the new execution/account paths.** `tradingUnifiedAccounts`, `tradingExecutionRequests`, `tradingExecutionResults`, and `tradingAudit` have no committed rule. Threat: a future client-side write could bypass the Admin SDK. **Remediation:** add owner-read + admin-write rules matching the safe pattern. **Risk of no change:** speculative; no client-side write path currently exists.
2. **Role derived client-side in rules (`users/{uid}/role`).** The rule `root.child('users').child(auth.uid).child('role').val() === 'admin'` reads role client-side, which is insecure by itself. **Remediation:** rely on `auth.token.admin === true` (Firebase ID tokens carry the `admin` claim when minted by the server). No functional impact; low risk. **Note:** after P0-1 the role field is no longer client-writable, so this client-side derivation is no longer escalatable — but the same reasoning applies to the server's `requireAdmin`, which reads `users/{uid}/role` and is now protected at the rules layer.
3. **Client can enumerate protected accounts.** `trading_accounts/{userId}`, `trading_positions/{userId}`, `trading_orders/{userId}` allow any authenticated user to read (not write) another user's trading data. **Remediation:** the app-layer guards already enforce ownership; this is a minor detail-leakage risk on an authenticated session. Closed as low severity; no code change.
4. **Firewall: Firebase rules not deployed.** Checked-in rules were never audited against the live project. **Remediation:** deploy to Firebase (`firebase deploy --only database`) and verify with the emulator. **Risk:** production security claim pending deployment evidence. **Update 2026-10-19:** the checked-in ruleset was found to be **undeployable** (see P1-5) and the live instance was inspected read-only — it runs an older ruleset that does not contain the Bot Studio trees. Deployment evidence is still outstanding.
5. **The committed ruleset could not be parsed by the RTDB rules compiler.** Two defects made `firebase deploy --only database` fail: (a) six `"_comment"` string keys — the rules schema only accepts rule keys (`.read`/`.write`/`.validate`/`.indexOn`) and path keys, so a string value raises `Expected '{'`; (b) `data.child('user.uid')` in `workflowContexts` — a path literal may not contain `.`, so it raised `invalid path (user.uid) found while validating ruleset` and the whole ruleset was rejected (every rule then evaluated as denied). **Fixed:** the rationale was moved into this document (§2.1) and the path expression corrected to `data.child('user').child('uid')`, which matches the stored `WorkflowContext.user.uid` shape. The ruleset now compiles cleanly in the emulator.

### P2 — Meaningful weakness, limited scope

None confirmed as functional defects in this pass. All trading execution state (requests, results, audit) is server-authoritative and idempotent.

### P3 — Hardening / defense-in-depth

- `tradingviewMcp/{userId}` is read-only for clients; `.write: false` correctly prevents client writes to the MCP connection records.
- `aiUsageEvents`, `aiUsageDaily`, `aiUsageMonthly`, `aiUsageBudgets` are read:false/write:false (admin/observability only).
- `monetizationCaps` read:false/write:false (server.)
- `referral_clicks/.read: false` (server), `affiliate_clicks/.read: false` (server), `signalFollowers/.read: true` (public, read-only — marketing surface).
- `workflowAutomationMarketplace/{itemId}` and `affiliate_conversions/{id}` readable (marketing surfaces).
- Expired-scoped gateway tokens are never minted stale on the client (the EA refreshes via heartbeat).

## 5. Findings register (synced with `BUGS_AND_REGRESSIONS.md`)

| ID | Severity | Finding | Evidence | Remediation |
|---|---|---|---|---|
| F-001 | P1 | New trading execution/account RTDB paths have no committed rule | `database.rules.json` end < 700 lines shows no `tradingUnifiedAccounts/tradingExecutionRequests/tradingExecutionResults/tradingAudit` | Add owner-read + admin-write rules; deploy + emulator verify |
| F-002 | P1 | `users/{uid}/role` read client-side in rules | `database.rules.json` root `users` path | Rely on `auth.token.admin === true`; keep `auth.uid === $uid` |
| F-003 | P1 | Authenticated user can read another user's trading account/positions/orders | `trading_accounts/{userId}/.read: auth.uid === $userId` | Low severity; app-layer guards enforce ownership; documented |
| F-004 | P2 | Firebase rules not verified deployed | No emulator run in this environment | `firebase deploy --only database`; emulator audit |
| F-005 | P3 | Gateway token verification relies on RTDB reads at request time | `verifyGatewayToken` reads `gateway_users/{token}` | Already call-limited; no client exposure. Monitor rate limits |
| F-006 | **P0** | Client could self-grant Pro/Enterprise and escalate `role` to `admin` by writing `users/{uid}` | Emulator: pre-fix ruleset fails 10/47 assertions; `users/ownerA/subscription` rewritten to `{"plan":"enterprise"}`; `role` set to `admin` | **Fixed** — server-only `.validate` rules on `subscription`, `developerSubscription`, `developerPlan`, `developerApproved`, `developerStatus`, `stripeConnect`; `role` validated (no self-escalation) |
| F-007 | **P0** | `GET /api/bot-studio/deployments` returned every user's deployments to any Pro user | `app/api/bot-studio/deployments/route.ts` (pre-fix: `const deployments = await listAllDeployments()`) | **Fixed** — filter by `ownerId` for non-admins; test in `npm run test:security:bot-studio` |
| F-008 | **P0** | Strategy PATCH / duplicate POST / DELETE / backtest performed Admin-SDK writes without an ownership check | `app/api/bot-studio/strategies/[strategyId]/route.ts`, `.../backtest/route.ts` (pre-fix) | **Fixed** — `canAccessStrategy` gate, non-owners get 404 |
| F-009 | **P1** | Committed ruleset was not parseable by the RTDB rules compiler (six `_comment` string keys; `data.child('user.uid')` path literal) | Emulator startup: `Expected '{'` at 1028:19; `invalid path (user.uid) found while validating ruleset` — the whole ruleset was rejected and every rule evaluated as denied | **Fixed** — rationale moved to §2.1 of this document; path expression corrected to `data.child('user').child('uid')` |
| F-010 | P2 | Live instance runs an older ruleset than the repository | Read-only `firebase database:get /.settings/rules --project algovault-4c564` → 134 top-level paths vs 187 in the repo; **all Bot Studio `bot_*` trees are absent from the live rules** (they fall through to the deny-by-default root, so clients still cannot touch them) | `firebase deploy --only database` once the ruleset is confirmed deployable |

## 6. Route-to-permission test matrix

| Route / operation | Auth required | Identity verified server-side | Required role / entitlement | Admin route? | Negative test |
|---|---|---|---|---|---|
| `/api/trading/execute` | Yes (Bearer) | Firebase `verifyIdToken` | Active trading license + DEMO | No | Unauthenticated → 401; no license → 403; LIVE → 403; cross-user → denied |
| `/api/trading/access/validate` | Yes | Firebase `verifyIdToken` | None (returns license state) | No | Token forgery → 401 |
| `/api/trading/orders` (POST) | Yes | Firebase `verifyIdToken` | Active trading license | No | No license → 403; body-supplied userId/accountId ignored → ownership from token |
| `/api/trading/positions` (GET) | Yes | Firebase `verifyIdToken` | None | No | Unauthenticated → 401 |
| `/api/trading/accounts` (GET) | Yes | Firebase `verifyIdToken` | None | No | Unauthenticated → 401 |
| `/api/trading/history` (GET) | Yes | Firebase `verifyIdToken` | None | No | Unauthenticated → 401 |
| `/api/trading/gateway/*` (register, heartbeat, execution, commands) | Yes (gateway token) | `verifyGatewayToken` reads `gateway_users/{token}` | None (gateway-side env) | No | Unknown gateway token → 403 |
| `/api/admin/*` (all) | Yes | Firebase `verifyIdToken` | Admin role | Yes | Customer token → 403; no token → 401 |
| `/api/stripe/webhook` | Yes | Stripe signature verify | None (webhook) | No | Invalid/stale signature → 400; duplicate → idempotent |
| `/api/stripe/checkout` | Yes | Firebase `verifyIdToken` | None (free checkout) | No | No token → 401 |
| `/api/subscription-status` | Yes | Firebase `verifyIdToken` | None | No | No token → 401 |
| `/api/license/validate` | Yes | Firebase `verifyIdToken` | None | No | No token → 401 |
| `/api/marketplace/purchase/{id}` (redirect) | Yes | Firebase `verifyIdToken` | None | No | Wrong account → 403 |
| `/api/candel/candel/*` (workspace, memory) | Yes | Firebase `verifyIdToken` | Owner of candelId + admin | No | Unauthenticated → 401; cross-user read denied |
| `/api/account/*` (paid features) | Yes | Firebase `verifyIdToken` | Active subscription | No | Expired subscription → gated |

Negative cases are exercised by `tests/security/route-auth-negative.test.ts` (application layer) plus the integrated trading suites (end-to-end entity ownership) and `tests/run-seo-security-tests.ts`.

## 7. Firebase Emulator / deployment verification status

| Verification | Status | Evidence / next step |
|---|---|---|
| Checked-in `database.rules.json` audited | Done | Static path listing above |
| Emulator rules test | **PASS (2026-10-19)** | `npm run test:rtdb-rules` boots the RTDB + Auth emulators against the committed ruleset: **47/47 assertions pass**. The same suite against the pre-fix ruleset fails **10/47**, which is the before/after evidence for F-006. Requires the `firebase` CLI and a JDK 21+; the probe SKIPs (exit 0) with an explanatory message when either is missing, so it can never be mistaken for a pass. |
| Bot Studio route authorization | **PASS (2026-10-19)** | `npm run test:security:bot-studio` — non-Pro/anonymous/unverifiable token → 401; deployment listing owner-scoped; admin sees all; non-owner strategy GET/PATCH/DELETE → 404 with the stored record unmutated. Negative control: the suite fails against the pre-fix deployments route. |
| Bot Studio ownership helpers | **PASS (2026-10-19)** | `npm run test:bot-studio-access` — `canAccessStrategy` / `canAccessDeployment` fail closed for missing/ownerless records. |
| Production rules deployed | **NOT VERIFIED** | The live instance was inspected **read-only** on 2026-10-19 (`firebase database:get /.settings/rules --project algovault-4c564`). It runs an **older** ruleset: 134 top-level paths vs 187 in the repository, and **none of the Bot Studio `bot_*` trees are present** (they therefore inherit the deny-by-default root — clients still cannot read or write them, and Bot Studio only uses the Admin SDK). The repository ruleset had **not** been deployable before this pass (F-009), so it could not have been deployed since 2026-10-05. Outstanding action: `firebase deploy --only database`, then re-run this section. |
| Application-layer auth tests | PASS | `npm run test:security` (route-auth-negative) → 25/25 checks, exit 0; negative control (one inverted assertion) exits 1 |
| Integrated trading suites | PASS | trading 32, unified-trading 112/112 |

## 8. Cache coherence / server-client boundary

- `deviceWorkspace`, `userPreferences` are owner-readable, server-only writable via `/api/mobile/workspace` and `/api/mobile/preferences` (revision bump enforced server-side). This is correct for deterministic conflict resolution.
- `growthJobs`/`growthEvents` `publicWrite` gate is server-side only (checks a server node), not user-controllable.
- No client writes to `tradingUnifiedAccounts`, `tradingExecutionRequests/results/audit`, `licenses`, or `subscriptions` directly — all confirmed above.

## 9. Summary

Section C is complete to the evidence available. The 2026-10-19 Bot Studio / entitlement pass confirmed and fixed three P0 defects (client-writable entitlement + role escalation under `users/{uid}`; unfiltered Bot Studio deployment listing; missing strategy ownership checks) and one P1 deployability defect (the ruleset did not parse). The application-layer guarantees (server-side verified identity, admin role, active-license entitlement, idempotency) are in place and covered by negative tests, and the RTDB rules are now covered by a runtime emulator suite rather than static reading alone.

The remaining risk is deployment evidence: the live instance still runs the pre-Bot-Studio ruleset, and the repository ruleset has only now become deployable. `firebase deploy --only database` plus a re-run of §7 is the outstanding action.
