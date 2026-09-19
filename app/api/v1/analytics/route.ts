import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { validateApiKey } from "@/lib/api-key-auth";

export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization");
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
        const userId = await validateApiKey(token);
        if (!userId) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });

        const accountsSnap = await adminDatabase.ref(`trading_accounts/${userId}`).get();
        let totalBalance = 0, totalEquity = 0, totalMargin = 0, totalPositions = 0;

        if (accountsSnap.exists()) {
            const data = accountsSnap.val();
            for (const [, acc] of Object.entries(data)) {
                const a = acc as Record<string, unknown>;
                totalBalance += Number(a.balance || 0);
                totalEquity += Number(a.equity || 0);
                totalMargin += Number(a.margin || 0);

                const posSnap = await adminDatabase.ref(`trading_positions/${userId}/${Object.keys(data).find((k) => data[k] === acc)}`).get();
                if (posSnap.exists()) totalPositions += Object.keys(posSnap.val()).length;
            }
        }

        return NextResponse.json({
            success: true,
            analytics: {
                totalBalance: Number(totalBalance.toFixed(2)),
                totalEquity: Number(totalEquity.toFixed(2)),
                totalMargin: Number(totalMargin.toFixed(2)),
                floatingPnl: Number((totalEquity - totalBalance).toFixed(2)),
                totalPositions,
                marginUtilization: totalBalance > 0 ? Number(((totalMargin / totalBalance) * 100).toFixed(2)) : 0,
            },
        });
    } catch (err) {
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
