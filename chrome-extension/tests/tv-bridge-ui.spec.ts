/**
 * TradingView Account & Execution Bridge — UI contract tests.
 *
 * Same source/bundle-level style as the popup layout regression tests in
 * `extension-smoke.spec.ts`: the confirmation flow, honest-data rendering and
 * Pro preview must not regress even when the views are restructured.
 *
 * The bundle assertion reads the BUILT side panel (what a user actually
 * installs) and is skipped when `npm run build` has not run yet.
 */
import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const DIST_ASSETS = fileURLToPath(new URL("../dist/assets", import.meta.url));

const read = (rel: string) => readFileSync(`${SRC}/${rel}`, "utf8");

test.describe("Trade ticket confirmation surface", () => {
  const ticket = read("sidepanel/views/ProTradeTicketView.tsx");

  test("requires an explicit review-and-confirm step", () => {
    expect(ticket).toContain("Review &amp; Confirm Trade");
    expect(ticket).toContain("handleConfirmAndExecute");
    // The AI never executes on its own.
    expect(ticket).toContain("the AI never executes orders");
  });

  test("requires a live acknowledgement for live/unreported accounts", () => {
    expect(ticket).toContain("requiresLiveAcknowledgement");
    expect(ticket).toContain("I understand this order");
    expect(ticket).toContain("LIVE ORDER");
  });

  test("renders the execution lifecycle instead of claiming a fill", () => {
    expect(ticket).toContain("statusTimeline");
    expect(ticket).toContain("PREPARING");
    expect(ticket).toContain("SUBMITTING");
    expect(ticket).toContain("UNKNOWN");
    // "Trade Executed" belongs to the receipt only, never the ticket.
    expect(ticket).not.toContain("Trade Executed");
  });

  test("exposes the preparation handoff when execution is unavailable", () => {
    expect(ticket).toContain("Execution unavailable");
    expect(ticket).toContain("Open in TradingView");
    expect(ticket).toContain("Blocked from execution");
  });

  test("runs the Execution Risk Check before confirmation", () => {
    expect(ticket).toContain("Run Execution Risk Check");
    expect(ticket).toContain("ProRiskGuardPanel");
  });

  test("stale market context is surfaced instead of silently used", () => {
    expect(ticket).toContain("staleContext");
    expect(ticket).toContain("older than 2 minutes");
  });
});

test.describe("Trading account panel", () => {
  const panel = read("sidepanel/views/ProTradingAccountPanel.tsx");

  test("shows only reported account data", () => {
    expect(panel).toContain("Account information unavailable");
    expect(panel).toContain("Not detected");
    expect(panel).toContain("modeLabel(account.mode)");
    // No hardcoded broker/account fallbacks.
    expect(panel).not.toContain('"MT5 Gateway"');
    expect(panel).not.toContain("account.balance ??");
  });

  test("surfaces connection, execution state and freshness", () => {
    expect(panel).toContain("TradingView");
    expect(panel).toContain("Execution");
    expect(panel).toContain("accountAgeLabel");
    expect(panel).toContain("Capability limitation");
  });

  test("keeps a persistent live-account warning", () => {
    expect(panel).toContain("LIVE ACCOUNT");
    expect(panel).toContain("treat it as LIVE");
  });
});

test.describe("Risk guard, receipt, positions and orders", () => {
  test("risk guard never invents a value", () => {
    const guard = read("sidepanel/views/ProRiskGuardPanel.tsx");
    expect(guard).toContain("RISK_NOT_CALCULABLE_MESSAGE");
    expect(guard).toContain("Not reported");
    expect(guard).toContain("Missing risk input");
    expect(guard).toContain("Execution Risk Check");
  });

  test("receipt syncs into the journal through the authenticated client", () => {
    const receipt = read("sidepanel/views/ProTradeReceiptView.tsx");
    expect(receipt).toContain("syncToJournal");
    // A relative fetch inside an extension page can never reach the API.
    expect(receipt).not.toContain('fetch("/api/extension/journal-sync")');
    expect(receipt).toContain("Open in TradingView");
    expect(receipt).toContain("Open in AlgoVault");
    expect(receipt).toContain("Add to Journal");
    expect(receipt).toContain("Not reported by venue");
  });

  test("position close and modify require in-panel confirmation", () => {
    const positions = read("sidepanel/views/ProPositionMonitorView.tsx");
    expect(positions).toContain("Confirm Close");
    expect(positions).toContain("Confirm Modify");
    expect(positions).toContain("P/L not reported");
    expect(positions).toContain("AI position monitoring is informational only");
  });

  test("pending orders only expose the supported cancel action", () => {
    const pending = read("sidepanel/views/ProPendingOrdersView.tsx");
    expect(pending).toContain("Confirm Cancel");
    expect(pending).toContain("cancelGatewayOrder");
    // The EA cannot modify a pending order — no modify affordance exists.
    expect(pending).not.toContain("Confirm Modify");
  });
});

test.describe("Command center, Pro preview and AI → ticket flow", () => {
  const bridge = read("sidepanel/views/ProExecutionBridgeView.tsx");

  test("command center reports real capability surfaces", () => {
    expect(bridge).toContain("TradingView Execution");
    expect(bridge).toContain("Open positions");
    expect(bridge).toContain("Pending orders");
    expect(bridge).toContain("Execution History");
    expect(bridge).toContain("Trade History");
  });

  test("non-Pro users see a preview with no privileged actions", () => {
    expect(bridge).toContain("Pro subscribers get the full execution bridge");
    expect(bridge).toContain("Entitlement is verified server-side");
    // The preview branch returns before the ticket is rendered.
    const previewIndex = bridge.indexOf("Pro subscribers get the full execution bridge");
    const ticketIndex = bridge.indexOf("<ProTradeTicketView");
    expect(previewIndex).toBeGreaterThan(-1);
    expect(ticketIndex).toBeGreaterThan(previewIndex);
  });

  test("setup radar prepares a trade without executing", () => {
    const radar = read("sidepanel/views/ProSetupRadarView.tsx");
    expect(radar).toContain("Prepare Trade");
    expect(radar).toContain("onPrepareTrade");
    expect(radar).toContain("nothing is executed until you confirm");

    const app = read("sidepanel/App.tsx");
    expect(app).toContain("handlePrepareTrade");
    expect(app).toContain("preparedDraft");
  });

  test("trade-management commands reach the copilot / positions panel", () => {
    const bar = read("sidepanel/components/CommandBar.tsx");
    expect(bar).toContain("show_open_positions");
    expect(bar).toContain("prepare_modification");
    expect(bar).toContain("prepare_close");
    expect(bar).toContain("show_market_context");
  });
});

test.describe("Account service honesty (source contract)", () => {
  const service = read("services/tv-account-service.ts");

  test("no fabricated balances, margin or mode defaults", () => {
    expect(service).not.toContain("10000");
    expect(service).not.toContain("marginLevel: 100");
    expect(service).not.toContain('"TradingView (Read-Only MCP)"');
    expect(service).toContain("No value is invented");
    expect(service).toContain('mode: "UNKNOWN"');
  });

  test("execution adapter ships the mandated safety messages", () => {
    const adapter = read("services/execution-adapter.ts");
    expect(adapter).toContain("EXECUTION_UNCONFIRMED_MESSAGE");
    expect(adapter).toContain("RISK_NOT_CALCULABLE_MESSAGE");
    expect(adapter).toContain("userConfirmed");
    expect(adapter).toContain("liveAcknowledged");
  });
});

test.describe("Built side panel bundle", () => {
  test("ships the confirmation flow to users", () => {
    const assets = existsSync(DIST_ASSETS) ? readdirSync(DIST_ASSETS) : [];
    const bundle = assets.find((f) => /^sidepanel-[\w-]+\.js$/.test(f));
    if (!bundle) {
      test.skip(true, "dist/assets/sidepanel-*.js not found — run `npm run build` first");
      return;
    }
    const code = readFileSync(`${DIST_ASSETS}/${bundle}`, "utf8");
    expect(code).toContain("Review & Confirm Trade");
    expect(code).toContain("Execution Risk Check");
    expect(code).toContain("Account information unavailable");
  });
});
