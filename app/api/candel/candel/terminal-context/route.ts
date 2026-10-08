import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { buildTerminalCandelContext } from "@/lib/candel/terminal-context";
import { requireCandelReadable } from "@/lib/candel/authorization";
import type { TerminalState } from "@/lib/terminal/types";
import { getCandelTemplate, getCandelInstance, getCandelAccountBindings } from "@/lib/candel/workspace/database";
import type { CandelAccountContext } from "@/lib/candel/types";
import type { CandelTemplate, CandelInstance } from "@/lib/candel/types";
import type { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { buildMarketIntelligenceContext } from "@/lib/market-intelligence/market-context";

// GET /api/candel/candel/terminal-context — return the authoritative thin adapter
// context for the currently open Candel (via candelId). The terminal calls this
// after the user selects a Candel; the response is the normalized
// TerminalCandelContext (no secrets).
//
// Terminal context contract (Phase 3):
//   symbol, timeframe, selectedAccountId, chartContext, marketDataContext,
//   indicators, marketStructure, activeStrategy, openPositions, riskContext
export async function GET(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    const symbol = searchParams.get("symbol") ?? "XAUUSD";
    const timeframe = searchParams.get("timeframe") ?? "M5";
    if (!candelId) {
      return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });
    }

    // Server-side authorization: the Candel owner may read terminal context.
    // requireCandelReadable is fail-closed — throws on any mismatch (cross-user,
    // cross-account, or unauthorized access), so any path here is a hard reject.
    await requireCandelReadable(candelId, token.uid);

    // Resolve the Candel instance + template (symbol/timeframe come from the
    // template; account bindings from RTDB). Server resolves identity — the
    // client never supplies candelId/accountId.
    const instance = await getCandelInstance(candelId);
    const template = instance ? await getCandelTemplate(instance.templateId) : null;
    const accountBindings = instance
      ? await getCandelAccountBindings(candelId)
      : [];

    // Build a minimal TerminalState matching the existing terminal
    // implementation (lib/terminal/types.ts). All children are required.
    const minimalTerminalState: TerminalState = {
      version: 1,
      workspace: "scalping",
      symbol: symbol as SupportedSymbol,
      timeframe: timeframe as Timeframe,
      watchlist: [],
      watchlistGroups: {},
      favorites: [],
      panels: {
        account: { visible: false, size: 0.5 },
        chart: { visible: true, size: 1.0 },
        intelligence: { visible: true, size: 0.7 },
        events: { visible: true, size: 0.5 },
        chat: { visible: false, size: 0.6 },
        sessions: { visible: false, size: 0.5 },
        monitor: { visible: false, size: 0.5 },
        watchlist: { visible: true, size: 0.8 },
      },
      intelligenceMode: "structure",
      chatOpen: false,
      accountMode: "unknown",
    };

    // Terminal exposes no account context directly (no balance/API keys).
    // Return a safe, normalized context. The Candel panel uses this for
    // market-only analysis when account context is unavailable.
    const context = buildTerminalCandelContext({
      symbol: symbol as SupportedSymbol,
      timeframe,
      terminalState: minimalTerminalState,
      accountBindings,
    });

    const payload: {
      success: boolean;
      candelId: string;
      accountBindingsCount: number;
      terminalContext: typeof context;
      accountContext: CandelAccountContext | null;
      proGated: boolean;
    } = {
      success: true,
      candelId,
      accountBindingsCount: accountBindings.length,
      terminalContext: context,
      accountContext: null,
      proGated: false,
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[candel/terminal-context GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load terminal context" }, { status: 500 });
  }
}
