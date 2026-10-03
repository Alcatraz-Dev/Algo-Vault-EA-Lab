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

export async function POST(request: NextRequest) {
  try {
    const user = await authenticate(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    const body = await request.json();

    // Security check: ensure no passwords/secrets/credentials in audit records
    const raw = JSON.stringify(body).toLowerCase();
    if (raw.includes("password") || raw.includes("secret") || raw.includes("privatekey")) {
      return NextResponse.json(
        { error: "Security violation: Sensitive fields not permitted in audit record." },
        { status: 400, headers: corsHeaders }
      );
    }

    const auditId = body.auditId || `audit-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const auditRecord = {
      auditId,
      requestId: body.requestId || "unknown-req",
      userId: user.uid,
      timestamp: body.timestamp || Date.now(),
      symbol: body.symbol || "UNKNOWN",
      side: body.side || "BUY",
      quantity: body.quantity || 0,
      accountMode: body.accountMode || "PAPER",
      brokerName: body.brokerName || "TradingView Bridge",
      status: body.status || "FILLED",
      details: body.details || "",
      userConfirmed: Boolean(body.userConfirmed),
    };

    await adminDatabase.ref(`executionAudit/${user.uid}/${auditId}`).set(auditRecord);

    return NextResponse.json(
      { success: true, auditId },
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    console.error("[POST /api/extension/execution-audit]", err);
    return NextResponse.json(
      { error: "Failed to store execution audit record." },
      { status: 500, headers: corsHeaders }
    );
  }
}
