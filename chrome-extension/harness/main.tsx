/**
 * Local preview harness for the TradingView Account & Execution Bridge.
 *
 * Renders the real side-panel components with fixture data so the ticket,
 * account panel, risk guard, position monitor, pending orders and receipt can
 * be inspected (and screenshotted) outside a Chrome extension host.
 *
 * Build:  npx vite build --config harness/vite.config.ts   (from chrome-extension/)
 */
import React from "react";
import { createRoot } from "react-dom/client";
import "./chrome-stub";

import "../src/sidepanel/styles.css";
import { ProTradingAccountPanel } from "../src/sidepanel/views/ProTradingAccountPanel";
import { ProTradeTicketView } from "../src/sidepanel/views/ProTradeTicketView";
import { ProRiskGuardPanel } from "../src/sidepanel/views/ProRiskGuardPanel";
import { ProPositionMonitorView } from "../src/sidepanel/views/ProPositionMonitorView";
import { ProPendingOrdersView } from "../src/sidepanel/views/ProPendingOrdersView";
import { ProTradeReceiptView } from "../src/sidepanel/views/ProTradeReceiptView";
import {
  createEmptyAccountInfo,
  maskAccountId,
  type ExecutionResult,
  type NormalizedOrderIntent,
  type RiskCheckResult,
  type TradingViewAccountInfo,
} from "../src/types/execution";

const LIVE_ACCOUNT: TradingViewAccountInfo = {
  ...createEmptyAccountInfo(),
  connectionStatus: "CONNECTED",
  accountState: "TRADING_ENABLED",
  tradingEnabled: true,
  broker: "ICMarkets-Live07",
  accountId: "gateway_4410293",
  accountIdMasked: maskAccountId("4410293"),
  accountType: null,
  mode: "UNKNOWN",
  modeSource: "gateway",
  currency: "USD",
  balance: 12500.5,
  equity: 12610.25,
  buyingPower: 11990,
  marginUsed: 620.25,
  marginFree: 11990,
  marginLevel: 2033.4,
  tradingPermissions: ["market_orders", "limit_orders", "stop_orders", "position_management"],
  supportedOrderTypes: ["market", "limit", "stop"],
  supportedActions: [
    "market_buy",
    "market_sell",
    "limit_buy",
    "limit_sell",
    "stop_buy",
    "stop_sell",
    "cancel_order",
    "modify_order",
    "close_position",
  ],
  openPositions: [
    {
      id: "991122",
      symbol: "XAUUSD",
      side: "BUY",
      quantity: 0.02,
      entryPrice: 2401.5,
      currentPrice: 2409.75,
      unrealizedPnl: 16.5,
      stopLoss: 2395,
      takeProfit: 2420,
      status: "OPEN",
      openTime: Date.now() - 3_600_000,
      broker: "ICMarkets-Live07",
      accountId: "gateway_4410293",
      canModify: true,
      canClose: true,
    },
    {
      id: "991123",
      symbol: "EURUSD",
      side: "SELL",
      quantity: 0.1,
      entryPrice: 1.0851,
      currentPrice: null,
      unrealizedPnl: null,
      stopLoss: 1.09,
      takeProfit: null,
      status: "OPEN",
      openTime: Date.now() - 7_200_000,
      broker: "ICMarkets-Live07",
      accountId: "gateway_4410293",
      canModify: true,
      canClose: true,
    },
  ],
  pendingOrders: [
    {
      id: "551122",
      symbol: "XAUUSD",
      side: "BUY",
      orderType: "LIMIT",
      quantity: 0.03,
      price: 2380,
      stopLoss: 2370,
      takeProfit: 2410,
      status: "PENDING",
      timestamp: Date.now() - 600_000,
      broker: "ICMarkets-Live07",
      accountId: "gateway_4410293",
      canModify: true,
      canCancel: true,
    },
  ],
  executionHistory: [
    {
      requestId: "ticket-m1a2b3-x9",
      symbol: "XAUUSD",
      side: "BUY",
      orderType: "BUY_LIMIT",
      quantity: 0.02,
      price: 2401.5,
      status: "filled",
      orderId: "889900",
      errorMessage: null,
      createdAt: Date.now() - 86_400_000,
      executedAt: Date.now() - 86_395_000,
    },
    {
      requestId: "ticket-p9q8r7-y2",
      symbol: "EURUSD",
      side: "SELL",
      orderType: "SELL",
      quantity: 0.5,
      price: null,
      status: "rejected",
      orderId: null,
      errorMessage: "Not enough money",
      createdAt: Date.now() - 43_200_000,
      executedAt: null,
    },
  ],
  tradingView: {
    chartConnected: true,
    chartLastSeenAt: Date.now() - 3_000,
    mcpState: "CONNECTED",
    mcpAuthorized: true,
    mcpMessage: "Connected to TradingView MCP.",
  },
  dataAvailability: { positions: true, pendingOrders: true, executionHistory: true, reason: null },
  lastSyncTimestamp: Date.now() - 4_000,
  source: "gateway",
  unsupportedReason: null,
};

const READONLY_ACCOUNT: TradingViewAccountInfo = {
  ...createEmptyAccountInfo(),
  connectionStatus: "CONNECTED",
  accountState: "EXECUTION_UNAVAILABLE",
  mode: "PAPER",
  modeSource: "tradingview-dom",
  broker: "TradingView broker panel",
  tradingView: {
    chartConnected: true,
    chartLastSeenAt: Date.now() - 2_000,
    mcpState: "CONNECTED",
    mcpAuthorized: true,
    mcpMessage: "Connected to TradingView MCP.",
  },
  unsupportedReason:
    "TradingView MCP is read-only (no account or execution tools). Connect the AlgoVault MT5 Gateway to enable execution.",
  dataAvailability: {
    positions: false,
    pendingOrders: false,
    executionHistory: false,
    reason: "TradingView MCP is read-only (no account or execution tools).",
  },
  lastSyncTimestamp: Date.now() - 6_000,
};

const RISK_OK: RiskCheckResult = {
  accountMode: "UNKNOWN",
  orderSize: 0.02,
  referencePrice: 2405.5,
  referencePriceSource: "market",
  estimatedExposure: 48.11,
  stopDistance: 10.5,
  riskAmount: 0.21,
  riskPercentage: 0.0017,
  potentialRiskReward: 1.38,
  missingRiskData: [],
  riskCalculable: true,
  brokerRestrictions: [],
  notes: "Risk evaluation passed.",
};

const RISK_UNKNOWN: RiskCheckResult = {
  accountMode: "UNKNOWN",
  orderSize: 0.02,
  referencePrice: null,
  referencePriceSource: "none",
  estimatedExposure: null,
  stopDistance: null,
  riskAmount: null,
  riskPercentage: null,
  potentialRiskReward: null,
  missingRiskData: ["Reference market price", "Account balance"],
  riskCalculable: false,
  brokerRestrictions: [],
  notes: "Risk could not be calculated from available data.",
};

const RECEIPT_INTENT: NormalizedOrderIntent = {
  requestId: "ticket-m1a2b3-x9",
  symbol: "XAUUSD",
  side: "BUY",
  orderType: "BUY_LIMIT",
  quantity: 0.02,
  price: 2401.5,
  stopLoss: 2395,
  takeProfit: 2420,
  accountId: "gateway_4410293",
  broker: "ICMarkets-Live07",
  mode: "UNKNOWN",
  strategyId: "strat-1",
  strategyName: "Liquidity Sweep Pro",
  setupId: "setup-7",
  analysisId: "analysis-3",
  timeframe: "M5",
};

const RECEIPT_RESULT: ExecutionResult = {
  requestId: "ticket-m1a2b3-x9",
  status: "FILLED",
  orderId: "ticket-m1a2b3-x9",
  executionPrice: 2401.75,
  filledQuantity: 0.02,
  timestamp: Date.now() - 86_395_000,
  error: null,
  mode: "UNKNOWN",
  broker: "ICMarkets-Live07",
  brokerTicket: "889900",
  uncertain: false,
  confirmed: true,
  statusTimeline: [
    { status: "PREPARING", at: Date.now() - 86_400_000 },
    { status: "SUBMITTING", at: Date.now() - 86_399_900 },
    { status: "ACCEPTED", at: Date.now() - 86_399_800 },
    { status: "FILLED", at: Date.now() - 86_395_000 },
  ],
  receipt: {
    orderId: "ticket-m1a2b3-x9",
    symbol: "XAUUSD",
    side: "BUY",
    quantity: 0.02,
    broker: "ICMarkets-Live07",
    accountReference: "••••0293",
    executionPrice: 2401.75,
    timestamp: Date.now() - 86_395_000,
    mode: "UNKNOWN",
    brokerTicket: "889900",
    strategyId: "strat-1",
    strategyName: "Liquidity Sweep Pro",
    setupId: "setup-7",
    analysisId: "analysis-3",
    timeframe: "M5",
    status: "FILLED",
    journalSynced: false,
  },
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-brand-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

function App() {
  return (
    <div className="min-h-screen bg-base p-4 text-ink" style={{ width: 420 }}>
      <Section title="Trading account (gateway connected · mode not reported)">
        <ProTradingAccountPanel account={LIVE_ACCOUNT} onRefresh={() => undefined} refreshing={false} />
      </Section>

      <Section title="Trade ticket (live-risk acknowledgement required)">
        <ProTradeTicketView
          account={LIVE_ACCOUNT}
          initialSymbol="XAUUSD"
          initialPrice={2405.5}
          timeframe="M5"
          marketPrice={2405.5}
          onExecutionComplete={() => undefined}
        />
      </Section>

      <Section title="Execution risk check">
        <div className="space-y-3">
          <ProRiskGuardPanel riskResult={RISK_OK} />
          <ProRiskGuardPanel riskResult={RISK_UNKNOWN} />
        </div>
      </Section>

      <Section title="Active positions">
        <ProPositionMonitorView account={LIVE_ACCOUNT} onRefresh={() => undefined} timeframe="M5" />
      </Section>

      <Section title="Pending orders">
        <ProPendingOrdersView account={LIVE_ACCOUNT} onRefresh={() => undefined} />
      </Section>

      <Section title="Trade receipt (confirmed fill)">
        <ProTradeReceiptView
          result={RECEIPT_RESULT}
          intent={RECEIPT_INTENT}
          onNewTrade={() => undefined}
        />
      </Section>

      <Section title="Trading account (read-only / execution unavailable)">
        <ProTradingAccountPanel account={READONLY_ACCOUNT} onRefresh={() => undefined} refreshing={false} />
      </Section>

      <Section title="Trade ticket (execution unavailable → preparation handoff)">
        <ProTradeTicketView
          account={READONLY_ACCOUNT}
          initialSymbol="XAUUSD"
          initialPrice={2405.5}
          timeframe="M5"
          marketPrice={2405.5}
          onExecutionComplete={() => undefined}
        />
      </Section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
