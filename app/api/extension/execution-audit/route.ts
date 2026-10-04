import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export function OPTIONS() {
  return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

const SENSITIVE_KEY = /password|secret|token|cookie|credential|api[-_]?key|private/i;

/**
 * POST /api/extension/execution-audit
 *
 * Execution audit trail (§23) for debugging, transparency and support.
 * WHITELISTED safe metadata only — passwords, tokens, cookies, API keys and
 * broker credentials are rejected outright, and the result field is taken
 * from the reported execution state (never defaulted to a fill).
 */
export async function POST(request: NextRequest) {
  try {
    const user = await authenticate(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    const body = (await request.json()) as Record<string, unknown>;

    // Reject anything that carries a credential-shaped key or value.
    const raw = JSON.stringify(body).toLowerCase();
    if (
      raw.includes("password") ||
      raw.includes("secret") ||
      raw.includes("privatekey") ||
      raw.includes("cookie") ||
      /"api[-_]?key"\s*:/.test(raw) ||
      /"token"\s*:/.test(raw)
    ) {
      return NextResponse.json(
        { error: "Security violation: sensitive fields are not permitted in audit records." },
        { status: 400, headers: corsHeaders }
      );
    }

    const str = (v: unknown, fallback = ""): string =>
      typeof v === "string" ? v.slice(0, 300) : fallback;
    const numOrNull = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : null;

    const auditId = str(body.auditId || body.id, `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

    const auditRecord: Record<string, unknown> = {
      auditId,
      requestId: str(body.requestId, "unknown-req"),
      userId: user.uid,
      timestamp: numOrNull(body.timestamp) ?? Date.now(),
      // Safe account metadata only (masked reference — never credentials).
      accountReference: str(body.accountReference || body.userId, "unknown"),
      broker: str(body.broker, "unknown"),
      accountMode: str(body.mode || body.accountMode, "UNKNOWN"),
      accountState: str(body.accountState, ""),
      // Order facts.
      symbol: str(body.symbol, "UNKNOWN"),
      side: str(body.action || body.side, "UNKNOWN"),
      orderType: str(body.orderType, "UNKNOWN"),
      quantity: numOrNull(body.quantity) ?? 0,
      price: numOrNull(body.price),
      // Real reported execution outcome — no default of "FILLED".
      status: str(body.result || body.status, "UNKNOWN"),
      orderId: body.orderId ? str(body.orderId) : null,
      errorCode: body.errorCode ? str(body.errorCode) : null,
      // Strategy / setup provenance.
      strategyId: body.strategyId ? str(body.strategyId) : null,
      setupId: body.setupId ? str(body.setupId) : null,
      userConfirmed: Boolean(body.userConfirmed ?? true),
      source: "extension_execution_bridge",
    };

    // Drop any residual non-whitelisted keys defensively.
    for (const key of Object.keys(auditRecord)) {
      if (SENSITIVE_KEY.test(key)) delete auditRecord[key];
    }

    await adminDatabase.ref(`executionAudit/${user.uid}/${auditId}`).set(auditRecord);

    return NextResponse.json({ success: true, auditId }, { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("[POST /api/extension/execution-audit]", err);
    return NextResponse.json(
      { error: "Failed to store execution audit record." },
      { status: 500, headers: corsHeaders }
    );
  }
}
