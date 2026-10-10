import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

// GET /api/candel/candel/accounts — trading accounts a Candel may be bound to.
//
// Reads the canonical owner-scoped tree `trading_accounts/{uid}` (the same one
// the terminal, risk and analytics surfaces use). Candel deliberately does NOT
// keep its own account registry — it binds to the accounts the user already
// connected.
export interface CandelBindableAccount {
  id: string;
  accountRef: string;
  broker: string;
  server: string;
  currency: string;
  balance: number;
  equity: number;
  status: string;
}

export async function GET(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const broker = searchParams.get("broker");

    const snapshot = await adminDatabase.ref(`trading_accounts/${token.uid}`).get();
    if (!snapshot.exists()) return NextResponse.json({ success: true, accounts: [] });

    const data = snapshot.val() as Record<string, Record<string, unknown>>;
    const accounts: CandelBindableAccount[] = [];
    for (const [id, val] of Object.entries(data)) {
      if (!val || typeof val !== "object") continue;
      if (broker && val.broker !== broker) continue;
      accounts.push({
        id,
        accountRef: String(val.mt5Account ?? val.accountId ?? id),
        broker: String(val.broker ?? ""),
        server: String(val.server ?? ""),
        currency: String(val.currency ?? "USD"),
        balance: Number(val.balance ?? 0),
        equity: Number(val.equity ?? 0),
        status: String(val.status ?? "offline"),
      });
    }
    accounts.sort((a, b) => a.accountRef.localeCompare(b.accountRef));

    return NextResponse.json({ success: true, accounts });
  } catch (error) {
    console.error("[candel/accounts GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load accounts" }, { status: 500 });
  }
}
