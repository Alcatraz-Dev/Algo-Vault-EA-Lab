import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { adminDatabase } from "@/lib/firebase-admin";
import { verifyGatewayToken, resolveGatewayToken } from "@/lib/gateway";
import { COMMAND_CLAIM_TTL_MS, MAX_CLAIMS_PER_POLL } from "@/lib/trading/gateway/lifecycle";

export const runtime = "nodejs";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const query: Record<string, unknown> = {
            gatewayToken: url.searchParams.get("gatewayToken") || "",
            accountNumber: url.searchParams.get("accountNumber") || "",
        };
        const gatewayToken = resolveGatewayToken(request.headers.get("authorization"), query);
        const accountNumber = String(query.accountNumber || "").trim();

        if (!gatewayToken || !accountNumber) {
            return NextResponse.json(
                { success: false, error: "gatewayToken and accountNumber are required." },
                { status: 400, headers: corsHeaders }
            );
        }

        const gatewayUser = await verifyGatewayToken(gatewayToken);
        if (!gatewayUser) {
            return NextResponse.json(
                { success: false, error: "Invalid gateway token." },
                { status: 403, headers: corsHeaders }
            );
        }

        const userId = gatewayUser.userId;
        const accountId = `gateway_${accountNumber}`;

        const commandsSnap = await adminDatabase
            .ref(`trading_order_requests/${userId}`)
            .get();

        const commandsData = commandsSnap.val() || {};
        const now = Date.now();
        const claimable: string[] = [];

        for (const [commandId, raw] of Object.entries(commandsData)) {
            if (!raw || typeof raw !== "object") continue;
            const cmd = raw as Record<string, unknown>;
            // Cheap pre-filter; the transaction below is the authority.
            if (cmd.status !== "queued" || String(cmd.accountId || "") !== accountId) continue;
            claimable.push(commandId);
            if (claimable.length >= MAX_CLAIMS_PER_POLL) break;
        }

        // CLAIM = one RTDB transaction per command. RTDB transactions are
        // atomic and re-run on contention, so when two gateway consumers poll
        // concurrently only the first commit can observe `status === "queued"`.
        // The loser re-runs, sees `executing`, aborts (returns undefined) and
        // therefore never receives the command.
        const claims = await Promise.all(
            claimable.map(async (commandId) => {
                const claimId = randomUUID();
                const outcome = await adminDatabase
                    .ref(`trading_order_requests/${userId}/${commandId}`)
                    .transaction((current) => {
                        if (!current || typeof current !== "object") return undefined;
                        const cmd = current as Record<string, unknown>;
                        if (cmd.status !== "queued") return undefined;
                        if (String(cmd.accountId || "") !== accountId) return undefined;
                        return {
                            ...cmd,
                            status: "executing",
                            executingAt: now,
                            gatewayRetrievedAt: now,
                            claimedAt: now,
                            claimId,
                            claimExpiresAt: now + COMMAND_CLAIM_TTL_MS,
                            claimAttempts: Number(cmd.claimAttempts ?? 0) + 1,
                            updatedAt: now,
                        };
                    });

                if (!outcome.committed) return null;
                const claimed = outcome.snapshot.val();
                if (!claimed || typeof claimed !== "object") return null;
                return { ...(claimed as Record<string, unknown>), id: commandId } as Record<string, unknown> & { id: string };
            })
        );

        const commands = claims.filter(
            (command): command is NonNullable<typeof command> => command !== null
        );

        // Secret-free lifecycle trace: which requests this poll claimed. Ids only;
        // never the gateway token or account number.
        if (commands.length > 0) {
            console.info("[trading/gateway/commands GET] claimed", {
                count: commands.length,
                clientRequestIds: commands.map((c) => String(c.clientRequestId ?? c.id)),
                claimAttempts: commands.map((c) => Number(c.claimAttempts ?? 0)),
            });
        }

        return NextResponse.json(
            {
                success: true,
                commands,
                // Tells the EA how long its claim is valid. After this the
                // command is reconciled, never re-queued for blind retry.
                claimExpiresAt: now + COMMAND_CLAIM_TTL_MS,
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (error) {
        console.error("[trading/gateway/commands GET]", error);
        return NextResponse.json(
            { success: false, error: "Failed to fetch commands." },
            { status: 500, headers: corsHeaders }
        );
    }
}
