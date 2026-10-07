import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { requireCandelOwner } from "@/lib/candel/authorization";

// GET /api/candel/candel/accounts — list the user's trading accounts (frontend-only; server scopes via token.uid)
export async function GET(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const broker = searchParams.get("broker");

    const snapshot = await adminDatabase.ref("accounts").get();
    if (!snapshot.exists()) return NextResponse.json({ success: true, accounts: [] });

    const data = snapshot.val() as Record<string, Record<string, unknown>>;
    const accounts: Record<string, unknown>[] = [];
    for (const [id, val] of Object.entries(data)) {
      if (val.userId !== token.uid) continue;
      if (broker && val.broker !== broker) continue;
      accounts.push({ id, ...val });
    }

    return NextResponse.json({ success: true, accounts });
  } catch (error) {
    console.error("[candel/accounts GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load accounts" }, { status: 500 });
  }
}
