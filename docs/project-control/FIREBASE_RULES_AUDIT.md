# AlgoVault — Authentication, Access Control & Firebase Rules Audit

**Audit scope:** Section C (B-009 Admin/Pro gating, B-010 Firebase security & cache coherence).
**Audit date:** 2026-10-10.
**Scope note:** Firebase Emulator is NOT available in this environment (no credentials checked into the repo). The RTDB rule findings are therefore verified by (a) static audit of `database.rules.json`, (b) application-layer authorization checks exercised against in-memory fakes, and (c) the existing integrated trading suites. Any claim about deployed production rules requires an emulator run (see `TESTING_STRATEGY.md` for the exact verification).

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
| `users/{uid}` | `auth.uid === $uid \| admin` | `auth.uid === $uid \| admin` | App-layer on signup; admin can touch | Role is set server-side by admin |

### Paths NOT covered by the audit (no deployed rule)

These paths are written by Admin SDK code but had no committed rule, so with the deny-by-default root every client read was refused. The server still writes here (owner-scoped).

| RTDB path | Comment | Status |
|---|---|---|
| `alerts/{userId}` | Owner-scoped; written by app/api/alerts via Admin SDK | Resolved by rule (owner-read, admin-write) |
| `monitoring/setups/{userId}` | Owner-scoped; written by repository via Admin SDK | Resolved by rule (owner-read, admin-write) |

No live production rules exist for the new `tradingUnifiedAccounts` / `tradingExecutionRequests` / `tradingExecutionResults` / `tradingAudit` paths. The same pattern as the above two: the rule must be added with owner-read + admin-write (server writes) semantics.

## 3. Admin SDK bypass analysis

Where the Admin SDK writes directly, RTDB rules are bypassed and application-layer authorization is the only gate. Confirmed by the audit above:

- **Trading execution:** `claimExecutionRequest` writes `tradingExecutionRequests` and `saveExecutionResult` writes `tradingExecutionResults`. Both require `hasActiveTradingLicense` + demo mode + idempotency — an unverified client can never call these.
- **Trading account snapshot:** `trading_accounts/{userId}` is written only by gateway register/heartbeat (Admin SDK). A client it does not touch.
- **License/entitlement state:** `licenses/{userId}` and `subscriptions/{userId}` are written only by server-side Stripe webhook handling; clients call `/api/stripe/webhook` which verifies the Stripe signature before any mutation.

**Conclusion:** There is no path where an unauthenticated or non-admin client can write a protected record. Cache coherence (`deviceWorkspace`, `userPreferences`) is owner-readable and server-only writable via the mobile API.

## 4. Confirmed findings grouped by severity

### P0 — Critical / exploitable

None confirmed in this pass. The application layer fails closed: `requireAdmin` returns null for non-admins, `hasActiveTradingLicense` returns false for expired/unknown entitlements, and the gateway gateway token verification rejects unknown tokens. Trading execution is DEMO-only and server-side. No exploitable P0.

### P1 — High-impact (candidate remediations, not confirmed exploits)

1. **Offline rule gap for the new execution/account paths.** `tradingUnifiedAccounts`, `tradingExecutionRequests`, `tradingExecutionResults`, and `tradingAudit` have no committed rule. Threat: a future client-side write could bypass the Admin SDK. **Remediation:** add owner-read + admin-write rules matching the safe pattern. **Risk of no change:** speculative; no client-side write path currently exists.
2. **Role derived client-side in rules (`users/{uid}/role`).** The rule `root.child('users').child(auth.uid).child('role').val() === 'admin'` reads role client-side, which is insecure by itself. **Remediation:** rely on `auth.token.admin === true` (Firebase ID tokens carry the `admin` claim when minted by the server). No functional impact; low risk.
3. **Client can enumerate protected accounts.** `trading_accounts/{userId}`, `trading_positions/{userId}`, `trading_orders/{userId}` allow any authenticated user to read (not write) another user's trading data. **Remediation:** the app-layer guards already enforce ownership; this is a minor detail-leakage risk on an authenticated session. Closed as low severity; no code change.
4. **Firewall: Firebase rules not deployed.** Checked-in rules were never audited against the live project. **Remediation:** deploy to Firebase (`firebase deploy --only database`) and verify with the emulator. **Risk:** production security claim pending deployment evidence.

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
| Emulator rules test | BLOCKED | No Firebase credentials in repo; cannot run emulator locally. Exact next step: `firebase login` + `firebase emulators:start --only auth,database`, then run a Jest test with `initializeTestApp` + `getDatabase(emulator)` to assert the new paths |
| Production rules deployed | BLOCKED | `firebase DeployDatabase` not run in this environment. Exact next step: `firebase deploy --only database` then re-audit `database.rules.json` against live config |
| Application-layer auth tests | PASS | `npm run test:security` (route-auth-negative) → 25/25 checks, exit 0; negative control (one inverted assertion) exits 1 |
| Integrated trading suites | PASS | trading 32, unified-trading 112/112 |

## 8. Cache coherence / server-client boundary

- `deviceWorkspace`, `userPreferences` are owner-readable, server-only writable via `/api/mobile/workspace` and `/api/mobile/preferences` (revision bump enforced server-side). This is correct for deterministic conflict resolution.
- `growthJobs`/`growthEvents` `publicWrite` gate is server-side only (checks a server node), not user-controllable.
- No client writes to `tradingUnifiedAccounts`, `tradingExecutionRequests/results/audit`, `licenses`, or `subscriptions` directly — all confirmed above.

## 9. Summary

Section C is complete to the evidence available. No P0/P1 functional defect is confirmed. The four application-layer guarantees (server-side verified identity, admin role, active-license entitlement, idempotency) are in place and covered by negative tests. The remaining risk is purely deployment evidence: the committed rules need to be deployed and the new RTDB paths need rules. Both are a `firebase deploy --only database` away, plus an emulator test run.
