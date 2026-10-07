/**
 * Chrome Extension → Unified Trading API — execution adapter contract tests.
 *
 * These tests pin the migration: every Extension execution action is expressed
 * as a Unified Trading request (`POST /api/trading/execute`) and every state the
 * Extension renders comes from the server's response. Nothing here asserts a
 * legacy gateway command shape, because none is produced any more.
 *
 * Only the Extension is exercised — the frozen Unified Trading implementation is
 * not touched.
 */
import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  UnifiedTradingError,
  cancelOrderRequest,
  closePositionRequest,
  executeUnifiedTrading,
  getUnifiedTradingHistory,
  modifyPositionRequest,
  newClientRequestId,
  partialClosePositionRequest,
  placeOrderRequest,
  runUnifiedExecution,
  type UnifiedExecutionPayload,
  type UnifiedExecutionResult,
  type UnifiedHistoryEntry,
} from "../src/api/unified-trading";
import { normalizeUnifiedHistory } from "../src/services/tv-account-service";
import {
  TradingViewExecutionAdapter,
  buildUnifiedExecutionPayload,
  lifecycleForUnifiedStatus,
  resetExecutionIdempotency,
  type ExecutionTransport,
} from "../src/services/execution-adapter";
import { buildOrderIntent, createTicketRequestId } from "../src/services/trade-ticket";
import {
  EXECUTION_UNCONFIRMED_MESSAGE,
  createEmptyAccountInfo,
  maskAccountId,
  type NormalizedOrderIntent,
  type TradingViewAccountInfo,
} from "../src/types/execution";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

/* ── fixtures ───────────────────────────────────────────────────────── */

const ACCOUNT_ID = "gateway_4410293";
const POSITION_ID = "889900";
const ORDER_ID = "771234";

function makeAccount(overrides: Partial<TradingViewAccountInfo> = {}): TradingViewAccountInfo {
  return {
    ...createEmptyAccountInfo(),
    connectionStatus: "CONNECTED",
    accountState: "TRADING_ENABLED",
    tradingEnabled: true,
    accountId: ACCOUNT_ID,
    accountIdMasked: maskAccountId("4410293"),
    broker: "TestBroker Markets",
    mode: "DEMO",
    modeSource: "gateway",
    balance: 10000,
    equity: 10000,
    unsupportedReason: null,
    ...overrides,
  };
}

function makeIntent(overrides: Partial<NormalizedOrderIntent> = {}): NormalizedOrderIntent {
  return {
    requestId: createTicketRequestId(),
    symbol: "EURUSD",
    side: "BUY",
    orderType: "MARKET",
    quantity: 0.1,
    mode: "DEMO",
    ...overrides,
  };
}

/** The exact envelope `POST /api/trading/execute` returns. */
function serverResult(
  payload: UnifiedExecutionPayload,
  result: Partial<UnifiedExecutionResult> = {}
): UnifiedExecutionResult {
  return {
    clientRequestId: payload.clientRequestId,
    correlationId: `corr-${payload.clientRequestId}`,
    accountId: payload.accountId,
    provider: "MT5",
    environment: "DEMO",
    executionType: payload.executionType,
    status: "SUCCEEDED",
    providerRef: null,
    filledVolume: null,
    filledPrice: null,
    order: null,
    position: null,
    error: null,
    duplicate: false,
    createdAt: 1_000_000,
    completedAt: 1_000_100,
    ...result,
  };
}

function serverRejection(
  payload: UnifiedExecutionPayload,
  code: string,
  message: string,
  status: number
): UnifiedTradingError {
  return new UnifiedTradingError(message, {
    code,
    status,
    result: serverResult(payload, { status: "REJECTED", error: { code, message } }),
  });
}

/** Captures every call so a retry can be proven to reuse the same key. */
function makeRecorder(handler?: (p: UnifiedExecutionPayload) => Promise<UnifiedExecutionResult>) {
  const calls: UnifiedExecutionPayload[] = [];
  const transport = async (payload: UnifiedExecutionPayload) => {
    calls.push(payload);
    return handler ? handler(payload) : serverResult(payload, { filledPrice: 1.1012, providerRef: "889900" });
  };
  return { transport, calls };
}

/* ── 1–5: action → Unified Trading request mapping ──────────────────── */

test.describe("execution action mapping", () => {
  test("1. a BUY market order maps to PLACE_ORDER with the BUY side", () => {
    const payload = placeOrderRequest({
      accountId: ACCOUNT_ID,
      clientRequestId: "ext-buy-0001",
      symbol: " eurusd ",
      side: "BUY",
      volume: 0.25,
      kind: "MARKET",
      stopLoss: 1.09,
      takeProfit: 1.12,
    });

    expect(payload).toEqual({
      accountId: ACCOUNT_ID,
      clientRequestId: "ext-buy-0001",
      executionType: "PLACE_ORDER",
      symbol: "EURUSD",
      side: "BUY",
      volume: 0.25,
      kind: "MARKET",
      price: null,
      stopLoss: 1.09,
      takeProfit: 1.12,
    });
  });

  test("2. a SELL limit order maps to PLACE_ORDER with the LIMIT kind and its price", () => {
    const payload = placeOrderRequest({
      accountId: ACCOUNT_ID,
      clientRequestId: "ext-sell-0002",
      symbol: "XAUUSD",
      side: "SELL",
      volume: 0.05,
      kind: "LIMIT",
      price: 2400.5,
    });

    expect(payload.executionType).toBe("PLACE_ORDER");
    expect(payload.side).toBe("SELL");
    expect(payload.kind).toBe("LIMIT");
    expect(payload.price).toBe(2400.5);
    expect(payload.symbol).toBe("XAUUSD");
  });

  test("3. a MODIFY SL/TP maps to MODIFY_POSITION by unified positionId", () => {
    const payload = modifyPositionRequest({
      accountId: ACCOUNT_ID,
      clientRequestId: "ext-mod-0003",
      positionId: POSITION_ID,
      symbol: "EURUSD",
      stopLoss: 1.095,
      takeProfit: 1.115,
    });

    expect(payload.executionType).toBe("MODIFY_POSITION");
    expect(payload.positionId).toBe(POSITION_ID);
    expect(payload.stopLoss).toBe(1.095);
    expect(payload.takeProfit).toBe(1.115);
    // A modification never carries an order size.
    expect(payload.volume).toBeUndefined();
  });

  test("4. a PARTIAL CLOSE sends the percentage and NOT a locally computed volume", () => {
    const payload = partialClosePositionRequest({
      accountId: ACCOUNT_ID,
      clientRequestId: "ext-partial-0004",
      positionId: POSITION_ID,
      // 50% of the CURRENT POSITION VOLUME (0.20 lots) — the server closes
      // 0.10; the Extension must not send 0.10 itself, and must never
      // interpret this as "50% of the profit".
      percentage: 50,
      symbol: "EURUSD",
    });

    expect(payload.executionType).toBe("PARTIAL_CLOSE");
    expect(payload.percentage).toBe(50);
    expect(payload.positionId).toBe(POSITION_ID);
    expect(payload.volume).toBeUndefined();
    expect(Object.keys(payload)).not.toContain("volume");
  });

  test("5. a FULL CLOSE maps to CLOSE_POSITION by unified positionId", () => {
    const payload = closePositionRequest({
      accountId: ACCOUNT_ID,
      clientRequestId: "ext-close-0005",
      positionId: POSITION_ID,
      symbol: "EURUSD",
    });

    expect(payload.executionType).toBe("CLOSE_POSITION");
    expect(payload.positionId).toBe(POSITION_ID);
    expect(payload.volume).toBeUndefined();
    expect(payload.percentage).toBeUndefined();
  });

  test("a pending-order cancel maps to CANCEL_ORDER by unified orderId", () => {
    const payload = cancelOrderRequest({
      accountId: ACCOUNT_ID,
      clientRequestId: "ext-cancel-0006",
      orderId: ORDER_ID,
      symbol: "GBPUSD",
    });

    expect(payload.executionType).toBe("CANCEL_ORDER");
    expect(payload.orderId).toBe(ORDER_ID);
    expect(Object.keys(payload)).not.toContain("ticket");
  });

  test("every builder emits only contract fields — never provider, environment or userId", () => {
    const payloads = [
      placeOrderRequest({
        accountId: ACCOUNT_ID,
        clientRequestId: "ext-0007",
        symbol: "EURUSD",
        side: "BUY",
        volume: 0.1,
      }),
      modifyPositionRequest({ accountId: ACCOUNT_ID, clientRequestId: "ext-0008", positionId: POSITION_ID }),
      closePositionRequest({ accountId: ACCOUNT_ID, clientRequestId: "ext-0009", positionId: POSITION_ID }),
      partialClosePositionRequest({
        accountId: ACCOUNT_ID,
        clientRequestId: "ext-0010",
        positionId: POSITION_ID,
        percentage: 25,
      }),
      cancelOrderRequest({ accountId: ACCOUNT_ID, clientRequestId: "ext-0011", orderId: ORDER_ID }),
    ];

    const ALLOWED = new Set([
      "accountId",
      "clientRequestId",
      "executionType",
      "symbol",
      "side",
      "volume",
      "percentage",
      "kind",
      "price",
      "stopLoss",
      "takeProfit",
      "positionId",
      "orderId",
    ]);

    for (const payload of payloads) {
      for (const key of Object.keys(payload)) {
        expect(ALLOWED.has(key)).toBe(true);
      }
    }
  });

  test("the ticket intent maps onto the same contract through the adapter", () => {
    const intent = makeIntent({ orderType: "LIMIT", price: 1.1, stopLoss: 1.09 });
    const payload = buildUnifiedExecutionPayload(intent, makeAccount());

    expect(payload.clientRequestId).toBe(intent.requestId);
    expect(payload.executionType).toBe("PLACE_ORDER");
    expect(payload.kind).toBe("LIMIT");
    expect(payload.price).toBe(1.1);
    expect(payload.stopLoss).toBe(1.09);
  });
});

/* ── 6–7: idempotency ───────────────────────────────────────────────── */

test.describe("idempotency", () => {
  test("6. the clientRequestId is preserved across retries of one logical action", async () => {
    let attempt = 0;
    const { transport, calls } = makeRecorder(async (payload) => {
      attempt += 1;
      // First attempt: the network never produced a verdict.
      if (attempt === 1) {
        throw new UnifiedTradingError("connection reset", { code: "NETWORK", status: 0 });
      }
      return serverResult(payload, { filledPrice: 1.1012, providerRef: "889900" });
    });

    // The key belongs to the user action, not to the attempt.
    const clientRequestId = newClientRequestId("retry");
    const request = placeOrderRequest({
      accountId: ACCOUNT_ID,
      clientRequestId,
      symbol: "EURUSD",
      side: "BUY",
      volume: 0.1,
    });

    const first = await runUnifiedExecution(request, transport);
    expect(first.status).toBe("UNKNOWN");
    expect(first.uncertain).toBe(true);
    expect(first.message).toBe(EXECUTION_UNCONFIRMED_MESSAGE);

    const second = await runUnifiedExecution(request, transport);
    expect(second.status).toBe("SUCCEEDED");

    expect(calls).toHaveLength(2);
    expect(calls[0].clientRequestId).toBe(clientRequestId);
    expect(calls[1].clientRequestId).toBe(clientRequestId);
  });

  test("7. a retry never mints a new idempotency key through the adapter", async () => {
    await resetExecutionIdempotency();
    const calls: UnifiedExecutionPayload[] = [];
    let attempt = 0;
    const transport: ExecutionTransport = {
      execute: async (payload) => {
        calls.push(payload);
        attempt += 1;
        if (attempt === 1) {
          throw new UnifiedTradingError("socket hang up", { code: "NETWORK", status: 0 });
        }
        return serverResult(payload, { filledPrice: 1.1, providerRef: "889900" });
      },
      postAudit: async () => undefined,
      postJournal: async () => ({ entryId: "entry-1" }),
      now: () => 1_000_000,
    };
    const adapter = new TradingViewExecutionAdapter({
      transport,
      checkEntitlement: async () => undefined,
    });

    const intent = makeIntent();
    const account = makeAccount();

    const first = await adapter.submitOrder(intent, account, { userConfirmed: true });
    expect(first.status).toBe("UNKNOWN");
    expect(first.uncertain).toBe(true);

    // The retry of this SAME action reuses the ticket's id — a fresh key here
    // would let the server accept a second trade.
    const retry = await adapter.submitOrder(intent, account, { userConfirmed: true });
    expect(retry.status).toBe("FILLED");

    expect(calls).toHaveLength(2);
    expect(calls[0].clientRequestId).toBe(intent.requestId);
    expect(calls[1].clientRequestId).toBe(intent.requestId);
    expect(new Set(calls.map((c) => c.clientRequestId)).size).toBe(1);

    await resetExecutionIdempotency();
  });

  test("the generated key satisfies the server's 8–128 character contract", () => {
    for (const prefix of ["ext", "close", "modify", "partial", "cancel", "ticket"]) {
      const id = newClientRequestId(prefix);
      expect(id.length).toBeGreaterThanOrEqual(8);
      expect(id.length).toBeLessThanOrEqual(128);
      expect(id.startsWith(`${prefix}-`)).toBe(true);
    }
    expect(newClientRequestId("a")).not.toBe(newClientRequestId("a"));
  });
});

/* ── 8–14: server response handling ─────────────────────────────────── */

test.describe("server response handling", () => {
  test("8. SUCCEEDED is reported as a confirmed fill", async () => {
    const payload = placeOrderRequest({
      accountId: ACCOUNT_ID,
      clientRequestId: "ext-ok-0001",
      symbol: "EURUSD",
      side: "BUY",
      volume: 0.1,
    });
    const outcome = await runUnifiedExecution(payload, async (p) =>
      serverResult(p, { filledPrice: 1.1012, filledVolume: 0.1, providerRef: "889900" })
    );

    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.ok).toBe(true);
    expect(outcome.pendingSync).toBe(false);
    expect(outcome.uncertain).toBe(false);
    expect(outcome.message).toBe("Order executed");
    expect(outcome.result?.providerRef).toBe("889900");
    expect(lifecycleForUnifiedStatus(outcome.status)).toBe("FILLED");
  });

  test("9. EXECUTED_PENDING_SYNC is a real execution awaiting its synced position", async () => {
    const payload = closePositionRequest({
      accountId: ACCOUNT_ID,
      clientRequestId: "ext-sync-0002",
      positionId: POSITION_ID,
    });
    const outcome = await runUnifiedExecution(payload, async (p) =>
      serverResult(p, { status: "EXECUTED_PENDING_SYNC", providerRef: "889900" })
    );

    expect(outcome.status).toBe("EXECUTED_PENDING_SYNC");
    expect(outcome.ok).toBe(true);
    expect(outcome.pendingSync).toBe(true);
    expect(outcome.uncertain).toBe(false);
    expect(outcome.message).toBe("Order executed — syncing position");
    expect(lifecycleForUnifiedStatus(outcome.status)).toBe("EXECUTED_PENDING_SYNC");
  });

  test("10. REJECTED shows the server's own user-facing reason", async () => {
    const payload = placeOrderRequest({
      accountId: ACCOUNT_ID,
      clientRequestId: "ext-rej-0003",
      symbol: "EURUSD",
      side: "BUY",
      volume: 0.1,
    });
    const outcome = await runUnifiedExecution(payload, async (p) => {
      throw serverRejection(p, "RISK_REJECTED", "The risk engine rejected this request.", 422);
    });

    expect(outcome.status).toBe("REJECTED");
    expect(outcome.ok).toBe(false);
    expect(outcome.uncertain).toBe(false);
    expect(outcome.message).toBe("The risk engine rejected this request.");
    expect(outcome.result?.error?.code).toBe("RISK_REJECTED");
    expect(lifecycleForUnifiedStatus(outcome.status)).toBe("REJECTED");
  });

  test("11. FAILED shows the server's actual failure", async () => {
    const payload = modifyPositionRequest({
      accountId: ACCOUNT_ID,
      clientRequestId: "ext-fail-0004",
      positionId: POSITION_ID,
    });
    const outcome = await runUnifiedExecution(payload, async (p) => {
      throw new UnifiedTradingError("provider reported INVALID_STOPS", {
        code: "UNKNOWN_PROVIDER_ERROR",
        status: 502,
        result: serverResult(p, {
          status: "FAILED",
          error: { code: "UNKNOWN_PROVIDER_ERROR", message: "provider reported INVALID_STOPS" },
        }),
      });
    });

    expect(outcome.status).toBe("FAILED");
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toBe("provider reported INVALID_STOPS");
    expect(lifecycleForUnifiedStatus(outcome.status)).toBe("FAILED");
  });

  test("12. a 409 duplicate / in-flight contract is reported as accepted, never as a fill", async () => {
    const payload = placeOrderRequest({
      accountId: ACCOUNT_ID,
      clientRequestId: "ext-dup-0005",
      symbol: "EURUSD",
      side: "BUY",
      volume: 0.1,
    });
    const outcome = await runUnifiedExecution(payload, async (p) => {
      throw serverRejection(
        p,
        "DUPLICATE_REQUEST",
        "An identical request is already in flight. Wait for the original result.",
        409
      );
    });

    expect(outcome.status).toBe("ACCEPTED");
    expect(outcome.ok).toBe(false);
    expect(outcome.uncertain).toBe(false);
    expect(outcome.message).toBe("Order accepted — waiting for broker confirmation");
    // The server's raw reason is preserved for diagnostics.
    expect(outcome.result?.error?.code).toBe("DUPLICATE_REQUEST");
    expect(lifecycleForUnifiedStatus(outcome.status)).toBe("ACCEPTED");
  });

  test("13. a stale / disconnected account surfaces the server's rejection", async () => {
    const payload = partialClosePositionRequest({
      accountId: ACCOUNT_ID,
      clientRequestId: "ext-stale-0006",
      positionId: POSITION_ID,
      percentage: 50,
    });
    const stale = await runUnifiedExecution(payload, async (p) => {
      throw serverRejection(
        p,
        "PROVIDER_STALE",
        "The provider connection is stale. Execution is blocked until the gateway reconnects.",
        409
      );
    });
    expect(stale.status).toBe("REJECTED");
    expect(stale.message).toContain("stale");

    const disconnected = await runUnifiedExecution(payload, async (p) => {
      throw serverRejection(p, "ACCOUNT_NOT_CONNECTED", "The trading account is not connected.", 409);
    });
    expect(disconnected.status).toBe("REJECTED");
    expect(disconnected.message).toBe("The trading account is not connected.");

    // Neither is ever reported as success.
    expect(stale.ok).toBe(false);
    expect(disconnected.ok).toBe(false);
  });

  test("14. an authentication failure is a definitive refusal, not an uncertain outcome", async () => {
    const payload = placeOrderRequest({
      accountId: ACCOUNT_ID,
      clientRequestId: "ext-auth-0007",
      symbol: "EURUSD",
      side: "BUY",
      volume: 0.1,
    });
    const outcome = await runUnifiedExecution(payload, async () => {
      throw new UnifiedTradingError("Unauthorized.", {
        code: "PERMISSION_DENIED",
        status: 401,
        result: null,
      });
    });

    expect(outcome.status).toBe("REJECTED");
    expect(outcome.ok).toBe(false);
    expect(outcome.uncertain).toBe(false);
    expect(outcome.message).toBe("Unauthorized.");
  });

  test("a network failure is the only state that may not be claimed either way", async () => {
    const payload = closePositionRequest({
      accountId: ACCOUNT_ID,
      clientRequestId: "ext-net-0008",
      positionId: POSITION_ID,
    });
    const outcome = await runUnifiedExecution(payload, async () => {
      throw new UnifiedTradingError("network_error", { code: "NETWORK", status: 0 });
    });

    expect(outcome.status).toBe("UNKNOWN");
    expect(outcome.uncertain).toBe(true);
    expect(outcome.message).toBe(EXECUTION_UNCONFIRMED_MESSAGE);
    expect(outcome.result).toBeNull();
  });

  test("runUnifiedExecution never throws, whatever the transport does", async () => {
    const payload = closePositionRequest({
      accountId: ACCOUNT_ID,
      clientRequestId: "ext-throw-0009",
      positionId: POSITION_ID,
    });
    const outcome = await runUnifiedExecution(payload, async () => {
      throw new Error("totally unexpected");
    });
    expect(outcome.status).toBe("UNKNOWN");
    expect(outcome.uncertain).toBe(true);
  });
});

/* ── transport security: what actually leaves the Extension ─────────── */

test.describe("HTTP contract & security", () => {
  function stubRuntime(respond: (url: string, init: RequestInit) => Response) {
    const captured: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
    const store: Record<string, unknown> = { authToken: "test-id-token" };
    const globals = globalThis as unknown as Record<string, unknown>;
    const previousFetch = globals.fetch;
    const previousChrome = globals.chrome;

    globals.chrome = {
      storage: {
        local: {
          get: (key: string, cb: (res: Record<string, unknown>) => void) => cb({ [key]: store[key] }),
          set: (payload: Record<string, unknown>, cb?: () => void) => {
            Object.assign(store, payload);
            cb?.();
          },
          remove: (key: string, cb?: () => void) => {
            delete store[key];
            cb?.();
          },
        },
      },
    };
    globals.fetch = async (url: string, init: RequestInit) => {
      captured.push({
        url: String(url),
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
        headers: (init.headers ?? {}) as Record<string, string>,
      });
      return respond(String(url), init);
    };

    return {
      captured,
      restore: () => {
        globals.fetch = previousFetch;
        if (previousChrome === undefined) delete globals.chrome;
        else globals.chrome = previousChrome;
      },
    };
  }

  test("a submission POSTs to /api/trading/execute with the caller's auth token only", async () => {
    const payload = placeOrderRequest({
      accountId: ACCOUNT_ID,
      clientRequestId: "ext-http-0001",
      symbol: "EURUSD",
      side: "BUY",
      volume: 0.1,
    });
    const runtime = stubRuntime(
      () =>
        new Response(
          JSON.stringify({
            success: true,
            duplicate: false,
            result: serverResult(payload, { filledPrice: 1.1012, providerRef: "889900" }),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    );

    try {
      const result = await executeUnifiedTrading(payload);
      expect(result.status).toBe("SUCCEEDED");

      expect(runtime.captured).toHaveLength(1);
      const call = runtime.captured[0];
      expect(call.url).toContain("/api/trading/execute");
      expect(call.url).not.toContain("/api/trading/orders");
      expect(call.headers.Authorization).toBe("Bearer test-id-token");

      // Identity comes from the token; the client never names a provider, an
      // environment, a live/demo mode or a user.
      for (const forbidden of ["provider", "environment", "userId", "mode", "ticket"]) {
        expect(Object.keys(call.body)).not.toContain(forbidden);
      }
      // It only adds a non-privileged origin marker.
      expect(call.body.source).toBe("chrome_extension");
      expect(call.body.accountId).toBe(ACCOUNT_ID);
    } finally {
      runtime.restore();
    }
  });

  test("a 401 response becomes a REJECTED outcome, never a retryable success", async () => {
    const payload = closePositionRequest({
      accountId: ACCOUNT_ID,
      clientRequestId: "ext-http-0002",
      positionId: POSITION_ID,
    });
    const runtime = stubRuntime(
      () =>
        new Response(JSON.stringify({ success: false, error: "Unauthorized." }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
    );

    try {
      const result = await executeUnifiedTrading(payload);
      throw new Error(`expected a refusal, got ${result.status}`);
    } catch (err) {
      expect(err).toBeInstanceOf(UnifiedTradingError);
      const error = err as UnifiedTradingError;
      expect(error.status).toBe(401);
      expect(error.code).toBe("PERMISSION_DENIED");
    } finally {
      runtime.restore();
    }
  });
});

/* ── 15: no legacy execution call may remain in the Extension ───────── */

test.describe("legacy execution route", () => {
  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = `${dir}/${entry}`;
      if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  }

  test("15. the Extension contains no runtime call to /api/trading/orders", () => {
    const files = sourceFiles(SRC);
    const mentioningLegacy = files.filter((file) => readFileSync(file, "utf8").includes("/api/trading/orders"));

    // Unified History Read Migration (Phase 9): the legacy gateway queue has
    // ZERO runtime references in the Extension — neither execution nor
    // Execution History reads it. (The server-side legacy route itself stays
    // intact for compatibility; documentation and tests may mention it.)
    expect(mentioningLegacy.map((f) => f.slice(SRC.length + 1))).toEqual([]);

    // Execution History reads through the Unified Trading history client.
    const historyClient = readFileSync(`${SRC}/api/unified-trading.ts`, "utf8");
    expect(historyClient).toContain("/api/trading/history");
    expect(historyClient).toContain("export async function getUnifiedTradingHistory");
    const legacyProbe = readFileSync(`${SRC}/api/execution.ts`, "utf8");
    expect(legacyProbe).toContain("getUnifiedTradingHistory");
    expect(legacyProbe).not.toContain("fetchOrderRequests");
    expect(legacyProbe).not.toContain("submitGatewayOrder");

    // No extension source file may reference a retired execution helper.
    for (const file of files) {
      const code = readFileSync(file, "utf8");
      for (const retired of [
        "submitGatewayOrder",
        "cancelGatewayOrder",
        "modifyGatewayPosition",
        "closeGatewayPosition",
        "gatewayActionFor",
      ]) {
        const calls = code.split("\n").filter((line) => line.includes(`${retired}(`));
        // A retired name may only survive inside a comment or a string literal.
        for (const line of calls) {
          const trimmed = line.trim();
          const isComment = trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*");
          expect(isComment || trimmed.includes("retired")).toBe(true);
        }
      }
    }
  });

  test("every execution surface in the Extension points at the Unified API client", () => {
    const executionSurfaces = [
      "services/execution-adapter.ts",
      "services/tv-account-service.ts",
      "sidepanel/views/ProPositionMonitorView.tsx",
      "sidepanel/views/ProPendingOrdersView.tsx",
      "popup/components/ExecuteView.tsx",
    ];
    for (const relative of executionSurfaces) {
      const code = readFileSync(`${SRC}/${relative}`, "utf8");
      expect(code).toContain("@/api/unified-trading");
      expect(code).not.toContain("@/api/trading/orders");
      expect(code).not.toContain("/api/trading/orders");
    }
  });
});

/* ── Execution History: the Unified read contract ─────────────────── */

test.describe("history read", () => {
  const historyEntry: UnifiedHistoryEntry = {
    clientRequestId: "ext-hist-0001",
    accountId: ACCOUNT_ID,
    symbol: "EURUSD",
    side: "BUY",
    kind: "MARKET",
    executionType: "PLACE_ORDER",
    volume: 0.1,
    filledVolume: 0.1,
    price: 1.1012,
    stopLoss: null,
    takeProfit: null,
    providerRef: "889900",
    state: "FILLED",
    result: "SUCCEEDED",
    errorMessage: null,
    createdAt: 1_700_000_000_000,
    executedAt: 1_700_000_005_000,
  };

  function stubHistoryRuntime(respond: () => Response) {
    const captured: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
    const store: Record<string, unknown> = { authToken: "test-id-token" };
    const globals = globalThis as unknown as Record<string, unknown>;
    const previousFetch = globals.fetch;
    const previousChrome = globals.chrome;

    globals.chrome = {
      storage: {
        local: {
          get: (key: string, cb: (res: Record<string, unknown>) => void) => cb({ [key]: store[key] }),
          set: (payload: Record<string, unknown>, cb?: () => void) => {
            Object.assign(store, payload);
            cb?.();
          },
          remove: (key: string, cb?: () => void) => {
            delete store[key];
            cb?.();
          },
        },
      },
    };
    globals.fetch = async (url: string, init: RequestInit = {}) => {
      captured.push({
        url: String(url),
        method: init.method ?? "GET",
        headers: (init.headers ?? {}) as Record<string, string>,
      });
      return respond();
    };

    return {
      captured,
      restore: () => {
        globals.fetch = previousFetch;
        if (previousChrome === undefined) delete globals.chrome;
        else globals.chrome = previousChrome;
      },
    };
  }

  test("history is read via GET /api/trading/history with the caller's auth token only", async () => {
    const runtime = stubHistoryRuntime(
      () =>
        new Response(
          JSON.stringify({
            success: true,
            accountId: ACCOUNT_ID,
            entries: [historyEntry],
            truncated: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    );

    try {
      const entries = await getUnifiedTradingHistory({ accountId: ACCOUNT_ID });
      expect(entries).toHaveLength(1);
      expect(entries[0].clientRequestId).toBe("ext-hist-0001");

      expect(runtime.captured).toHaveLength(1);
      const call = runtime.captured[0];
      expect(call.url).toContain("/api/trading/history");
      expect(call.url).toContain(`accountId=${ACCOUNT_ID}`);
      expect(call.method).toBe("GET");
      expect(call.url).not.toContain("/api/trading/orders");
      expect(call.headers.Authorization).toBe("Bearer test-id-token");
    } finally {
      runtime.restore();
    }
  });

  test("an auth refusal is an error, never an empty history", async () => {
    const runtime = stubHistoryRuntime(
      () =>
        new Response(JSON.stringify({ success: false, error: "Unauthorized." }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
    );

    try {
      await getUnifiedTradingHistory({ accountId: ACCOUNT_ID });
      throw new Error("expected a refusal, got a history");
    } catch (err) {
      expect(err).toBeInstanceOf(UnifiedTradingError);
      const error = err as UnifiedTradingError;
      expect(error.status).toBe(401);
      expect(error.code).toBe("PERMISSION_DENIED");
    } finally {
      runtime.restore();
    }
  });

  test("the client maps the Unified response without inventing fields", () => {
    const rows = normalizeUnifiedHistory([historyEntry]);
    expect(rows).toHaveLength(1);
    expect(rows[0].requestId).toBe("ext-hist-0001");
    expect(rows[0].status).toBe("FILLED");
    expect(rows[0].quantity).toBe(0.1);
    expect(rows[0].price).toBe(1.1012);
    expect(rows[0].orderId).toBe("889900");
    expect(rows[0].errorMessage).toBeNull();
  });
});

/* ── 16: the TradingView context still reaches the execution layer ──── */

test.describe("TradingView context", () => {
  test("16. the chart symbol and timeframe reach the execution layer unchanged", () => {
    const account = makeAccount();
    const intent = buildOrderIntent(
      {
        requestId: createTicketRequestId(),
        symbol: " xauusd ",
        side: "SELL",
        orderType: "MARKET",
        quantity: 0.02,
        price: null,
        stopLoss: 2390,
        takeProfit: 2420,
        timeframe: "M5",
        setupId: "setup-9",
      },
      account
    );

    const payload = buildUnifiedExecutionPayload(intent, account);
    expect(payload.symbol).toBe("XAUUSD");
    expect(payload.side).toBe("SELL");
    expect(payload.kind).toBe("MARKET");
    expect(payload.stopLoss).toBe(2390);
    expect(payload.takeProfit).toBe(2420);

    // The TradingView timeframe keeps flowing into the journal/receipt context.
    const adapter = new TradingViewExecutionAdapter({
      transport: {
        execute: async () => {
          throw new UnifiedTradingError("unused", { code: "NETWORK", status: 0 });
        },
        postAudit: async () => undefined,
        postJournal: async () => ({ entryId: "entry-1" }),
        now: () => 1_000_000,
      },
    });
    const journal = adapter.buildJournalPayload(
      {
        orderId: intent.requestId,
        symbol: payload.symbol,
        side: "SELL",
        quantity: 0.02,
        broker: "TestBroker Markets",
        accountReference: "••••0293",
        executionPrice: 2400,
        timestamp: 1_000_000,
        mode: "DEMO",
        status: "FILLED",
        journalSynced: false,
      },
      intent
    );

    expect(journal.timeframe).toBe("M5");
    expect(journal.symbol).toBe("XAUUSD");
    expect(journal.setupId).toBe("setup-9");
  });

  test("16b. the TradingView execution surface module is the only input layer", () => {
    // The content script must not contain execution logic: it publishes chart
    // context only. Provider-specific execution must never move into it.
    const contentScript = readFileSync(`${SRC}/content/tradingview.ts`, "utf8");
    expect(contentScript).not.toContain("/api/trading/");
    expect(contentScript).not.toContain("executeUnifiedTrading");
    expect(contentScript).toContain("TRADINGVIEW_CONTEXT_UPDATE");
  });
});
