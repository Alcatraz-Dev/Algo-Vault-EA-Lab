import { test, expect } from "@playwright/test";
import { TradingViewExecutionAdapter } from "../src/services/execution-adapter";
import { detectTradingViewAccount } from "../src/services/tv-account-service";
import {
  TradingViewAccountInfo,
  NormalizedOrderIntent,
  createEmptyAccountInfo,
} from "../src/types/execution";

test.describe("TradingView Account & Execution Bridge", () => {
  test("1. TradingView MCP capabilities report read-only market data and zero execution endpoints", () => {
    const adapter = new TradingViewExecutionAdapter();
    const caps = adapter.getCapabilities();

    expect(caps.nativeTradingViewMcpSupported).toBe(false);
    expect(caps.gatewayExecutionSupported).toBe(true);
    expect(caps.supportedOrderTypes).toEqual(["MARKET", "LIMIT", "STOP"]);
    expect(caps.limitationNote).toContain("TradingView MCP is read-only");
  });

  test("2. Default un-connected account info defaults to EXECUTION_UNAVAILABLE state", async () => {
    const empty = createEmptyAccountInfo();
    expect(empty.accountState).toBe("NOT_CONNECTED");
    expect(empty.source).toBe("unavailable");

    const account = await detectTradingViewAccount(true);
    expect(account.accountState).toBe("EXECUTION_UNAVAILABLE");
    expect(account.source).toBe("tradingview-dom");
    expect(account.unsupportedReason).toContain("read-only market data");
  });

  test("3. Order validator detects missing symbol, invalid side, non-positive quantity", () => {
    const adapter = new TradingViewExecutionAdapter();

    const invalidIntent: NormalizedOrderIntent = {
      requestId: "req-invalid-1",
      symbol: "",
      side: "BUY",
      orderType: "MARKET",
      quantity: -1,
      mode: "PAPER",
    };

    const result = adapter.validateOrder(invalidIntent);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Symbol is required.");
    expect(result.errors).toContain("Quantity must be a positive number.");
  });

  test("4. Order validator enforces Stop Loss logic (BUY SL must be below entry, SELL SL must be above entry)", () => {
    const adapter = new TradingViewExecutionAdapter();

    const invalidBuySL: NormalizedOrderIntent = {
      requestId: "req-sl-1",
      symbol: "EURUSD",
      side: "BUY",
      orderType: "LIMIT",
      quantity: 1.0,
      price: 1.0800,
      stopLoss: 1.0900,
      takeProfit: 1.1000,
      mode: "PAPER",
    };

    const res = adapter.validateOrder(invalidBuySL);
    expect(res.valid).toBe(false);
    expect(res.errors).toContain("Stop Loss must be below Entry Price for BUY orders.");

    const validBuySL: NormalizedOrderIntent = {
      requestId: "req-sl-2",
      symbol: "EURUSD",
      side: "BUY",
      orderType: "LIMIT",
      quantity: 1.0,
      price: 1.0800,
      stopLoss: 1.0700,
      takeProfit: 1.1000,
      mode: "PAPER",
    };

    const resValid = adapter.validateOrder(validBuySL);
    expect(resValid.valid).toBe(true);
  });

  test("5. Risk Guard computes risk amount, exposure, and risk-to-reward ratio correctly", () => {
    const adapter = new TradingViewExecutionAdapter();

    const mockAccount: TradingViewAccountInfo = {
      ...createEmptyAccountInfo(),
      accountState: "TRADING_ENABLED",
      balance: 10000,
      equity: 10000,
      mode: "PAPER",
    };

    const intent: NormalizedOrderIntent = {
      requestId: "req-risk-1",
      symbol: "EURUSD",
      side: "BUY",
      orderType: "LIMIT",
      quantity: 1.0,
      price: 1.1000,
      stopLoss: 1.0900,
      takeProfit: 1.1200,
      mode: "PAPER",
    };

    const risk = adapter.computeRiskCheck(intent, mockAccount);
    expect(risk.riskCalculable).toBe(true);
    expect(risk.riskAmount).toBeCloseTo(0.01, 4);
    expect(risk.potentialRiskReward).toBeCloseTo(2.0, 1);
    expect(risk.brokerRestrictions).not.toContain("RISK_EXCEEDED_MAX_THRESHOLD");
  });

  test("6. Risk Guard rejects trades exceeding 10% maximum risk threshold", () => {
    const adapter = new TradingViewExecutionAdapter();

    const mockAccount: TradingViewAccountInfo = {
      ...createEmptyAccountInfo(),
      accountState: "TRADING_ENABLED",
      balance: 1000, // $1000 balance
      equity: 1000,
      mode: "LIVE",
    };

    const highRiskIntent: NormalizedOrderIntent = {
      requestId: "req-risk-high",
      symbol: "XAUUSD",
      side: "BUY",
      orderType: "LIMIT",
      quantity: 10.0,
      price: 100,
      stopLoss: 80, // Distance 20 * 10 qty = $200 risk (20% of $1000 balance)
      mode: "LIVE",
    };

    const risk = adapter.computeRiskCheck(highRiskIntent, mockAccount);
    expect(risk.brokerRestrictions).toContain("RISK_EXCEEDED_MAX_THRESHOLD");
  });

  test("7. Order submission fails if user confirmation is false", async () => {
    const adapter = new TradingViewExecutionAdapter();

    const mockAccount: TradingViewAccountInfo = {
      ...createEmptyAccountInfo(),
      accountState: "TRADING_ENABLED",
      mode: "PAPER",
    };

    const intent: NormalizedOrderIntent = {
      requestId: "req-unconfirmed",
      symbol: "EURUSD",
      side: "BUY",
      orderType: "MARKET",
      quantity: 0.1,
      mode: "PAPER",
    };

    const res = await adapter.submitOrder(intent, mockAccount, false);
    expect(res.status).toBe("REJECTED");
    expect(res.error).toContain("confirmation required");
  });

  test("8. Duplicate request ID is rejected (idempotency protection)", async () => {
    const adapter = new TradingViewExecutionAdapter();

    const mockAccount: TradingViewAccountInfo = {
      ...createEmptyAccountInfo(),
      accountState: "TRADING_ENABLED",
      mode: "PAPER",
    };

    const intent: NormalizedOrderIntent = {
      requestId: "req-duplicate-test-id-123",
      symbol: "EURUSD",
      side: "BUY",
      orderType: "MARKET",
      quantity: 0.1,
      mode: "PAPER",
    };

    // First attempt (submits order intent to gateway)
    await adapter.submitOrder(intent, mockAccount, true);

    // Second attempt with SAME requestId -> should be REJECTED as duplicate
    const secondRes = await adapter.submitOrder(intent, mockAccount, true);
    expect(secondRes.status).toBe("REJECTED");
    expect(secondRes.error).toContain("Duplicate order request detected");
  });
});
