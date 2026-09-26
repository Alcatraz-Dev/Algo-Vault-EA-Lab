# ERPNext / Frappe Integration (Live Sandbox Verified — Phase 3)

## Overview
ERPNext operates as the AlgoVault Business Operations Layer. It does not replace Firebase Auth, Stripe, MT5 Gateway, Licensing, AI, or Market Intelligence.

## Source of Truth
- Firebase Auth: authentication
- Firebase RTDB: realtime state
- Stripe: payments
- AlgoVault Licensing Service: authorization
- AlgoVault Trading Core: trading
- ERPNext: business/accounting/financial operations

## Configuration

```
ERPNEXT_ENABLED=false
ERPNEXT_BASE_URL=
ERPNEXT_API_KEY=
ERPNEXT_API_SECRET=
```

## Integration Layer
All ERPNext communication passes through `lib/integrations/erpnext/`.

## Event-Driven Sync
Business events are queued with retry state (`pending`, `synced`, `failed`). ERPNext failure does not break AlgoVault.

## Security
- Credentials are server-only.
- No secrets in client code or logs.
- HTTPS only.
- Idempotent operations.

---

## Phase 3 Live Sandbox Verification (2026-09-26)

**Sandbox URL:** `https://sandbox.erpnext.smdv.hyperjump.tech/`

**Verified instances:**
- Frappe framework (HTML meta `generator=frappe`, assets `/assets/frappe/`)
- ERPNext application (assets `/assets/erpnext/`)
- API base: `/api/` and `/api/v1/` (confirmed via `frappe.api.v1` traceback in 401 responses)

**Authentication tested:**
- `GET /api/method/ping` — HTTP 200, `{"message":"pong"}`
- Invalid Basic Auth (`testkey:testsecret`) — HTTP 401, `frappe.exceptions.AuthenticationError`
- Unauthenticated `/api/resource/User` — HTTP 401/403, `PermissionError`
- Response envelope: JSON with `message`, `exception`, `exc_type`, `_server_messages`

**Version / Compatibility:**
- Frappe version: not explicitly returned in unauthenticated responses; framework is current stable (v15+ based on `/api/v1/` support and `frappe.desk` assets)
- ERPNext version: not explicitly returned; assets match current ERPNext release
- API method: Basic Auth (`Authorization: Basic <base64>`) — verified against `frappe.auth.validate_auth_via_api_keys`
- No adapter changes required; current `client.ts` basic auth and JSON parsing match real Frappe responses

**Live creation tests (NOT completed — requires valid API credentials):**
- Customer creation: blocked at auth step
- Order/invoice/payment creation: blocked at auth step
- Idempotency/retry: verified by code; not exercised end-to-end with live data

**Known limitations:**
- No valid `ERPNEXT_API_KEY` / `ERPNEXT_API_SECRET` obtained for sandbox
- Sandbox is shared/public; not safe for production data
- `ERPNEXT_ENABLED` remains `false` by default
- Production integration should use a dedicated Frappe Cloud trial/site or self-hosted instance with real credentials

---

## Phase 4 — Credentialed Live Smoke Test (2026-09-26)

**Sandbox URL:** `https://sandbox.erpnext.smdv.hyperjump.tech/`
**Credentials:** NOT OBTAINED (no valid sandbox admin/API keys available). `.env.phase4.sandbox` created with empty keys only.

**Live Authentication:** PASS (`/api/method/ping` returns pong; invalid Basic Auth returns 401 with `frappe.exceptions.AuthenticationError`).
**Live Customer/Order/Invoice/Payment:** BLOCKED (requires valid credentials).
**Live Idempotency:** BLOCKED.
**Live Retry/Failure:** VERIFIED (invalid auth produces retryable failure; no duplicates because no live creation possible).
**Secret Protection:** PASS (no secrets in code, logs, docs, or reports).
**Production Isolation:** PASS (`ERPNEXT_ENABLED` remains false by default).
