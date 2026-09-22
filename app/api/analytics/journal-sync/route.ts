import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

interface JournalNoteRecord {
    mt5Ticket?: unknown;
}

export async function POST(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const { accountId } = body;

        if (!accountId) {
            return NextResponse.json({ error: "accountId required" }, { status: 400 });
        }

        const tradesRef = adminDatabase.ref(`trades/${accountId}`);
        const snapshot = await tradesRef.get();

        if (!snapshot.exists()) {
            return NextResponse.json({ success: true, synced: 0, message: "No trades found" });
        }

        const tradesData = snapshot.val();
        const notesRef = adminDatabase.ref(`users/${user.uid}/notes`);
        const existingNotes = await notesRef.get();
        const existing = existingNotes.val() as Record<string, JournalNoteRecord> | null;

        const existingTickets = new Set(
            Object.values(existing || {}).map((note) => note.mt5Ticket).filter(Boolean)
        );

        let synced = 0;
        const now = Date.now();

        for (const [ticket, trade] of Object.entries(tradesData)) {
            const t = trade as Record<string, unknown>;

            if (existingTickets.has(String(t.ticket || ticket))) continue;

            const profit = Number(t.profit || 0);
            const commission = Number(t.commission || 0);
            const swap = Number(t.swap || 0);
            const netProfit = profit + commission + swap;

            const outcome = netProfit > 0 ? "win" : netProfit < 0 ? "loss" : "breakeven";

            const symbol = String(t.symbol || "");
            const type = String(t.type || "");
            const volume = Number(t.volume || 0);
            const openPrice = Number(t.openPrice || 0);
            const closePrice = Number(t.closePrice || 0);
            const openedAt = Number(t.openedAt || 0);
            const closedAt = Number(t.closedAt || 0);

            const durationMs = closedAt - openedAt;
            const durationHours = Math.floor(durationMs / (1000 * 60 * 60));
            const durationMinutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
            const durationStr = durationHours > 0 ? `${durationHours}h ${durationMinutes}m` : `${durationMinutes}m`;

            const tags = [symbol, type.toLowerCase()];
            if (volume >= 1) tags.push("large-position");
            if (Math.abs(netProfit) > 100) tags.push("high-pnl");

            const title = `${type} ${symbol} ${volume.toFixed(2)} lots — ${netProfit >= 0 ? "+" : ""}$${netProfit.toFixed(2)}`;

            const bodyText = [
                `## Trade Details`,
                `- **Symbol:** ${symbol}`,
                `- **Direction:** ${type}`,
                `- **Volume:** ${volume.toFixed(2)} lots`,
                `- **Open Price:** ${openPrice}`,
                `- **Close Price:** ${closePrice}`,
                `- **P&L:** $${netProfit.toFixed(2)}`,
                `- **Duration:** ${durationStr}`,
                `- **Ticket:** ${t.ticket || ticket}`,
                commission !== 0 ? `- **Commission:** $${commission.toFixed(2)}` : null,
                swap !== 0 ? `- **Swap:** $${swap.toFixed(2)}` : null,
            ].filter(Boolean).join("\n");

            const noteRef = notesRef.push();
            await noteRef.set({
                title,
                symbol,
                body: bodyText,
                tags,
                tradeOutcome: outcome,
                pnl: Number(netProfit.toFixed(2)),
                mt5Ticket: String(t.ticket || ticket),
                mt5AccountId: accountId,
                source: "mt5_sync",
                createdAt: closedAt || now,
                updatedAt: now,
            });

            synced++;
        }

        return NextResponse.json({ success: true, synced, total: Object.keys(tradesData).length });
    } catch (err) {
        console.error("Journal sync error:", err);
        return NextResponse.json({ error: "Failed to sync trades" }, { status: 500 });
    }
}
