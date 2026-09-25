import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { saveProSignal } from "@/features/telegram-signals/signals/signal-engine";
import { transitionSignalState } from "@/features/telegram-signals/lifecycle/state-machine";
import type { ProSignal } from "@/features/telegram-signals/types";
import { fetchCandles } from "@/lib/market-data/normalizer";

const MAX_SIGNALS_TO_CHECK = 200;

/**
 * Pro signal auto-update sweep — invoked by a cron/worker (vercel.json, every
 * 5 min) OR by an authenticated user from the Pro Signals page ("Scan" button,
 * which sends `Authorization: Bearer <idToken>`).
 *
 * Auth: accepts any of —
 *   - Vercel's cron runner (user-agent "vercel-cron")
 *   - `x-cron-secret` (or `?secret=`) matching CRON_SECRET
 *   - a valid Firebase ID token as `Authorization: Bearer <idToken>`
 * If CRON_SECRET is unset the cron paths are simply not available (the bearer
 * path still works); nothing runs unauthenticated.
 */
export async function POST(request: NextRequest) {
    try {
        const secret = process.env.CRON_SECRET;
        const headerSecret = request.headers.get("x-cron-secret") || "";
        const querySecret = new URL(request.url).searchParams.get("secret") || "";
        const isVercelCron = (request.headers.get("user-agent") || "").toLowerCase().includes("vercel-cron");
        const authorization = request.headers.get("Authorization") || "";
        const isBearer = authorization.startsWith("Bearer ");

        const cronAuthorized = isVercelCron || Boolean(secret && (headerSecret === secret || querySecret === secret));

        if (!cronAuthorized && !isBearer) {
            return NextResponse.json(
                { error: "Unauthorized. Set CRON_SECRET and send it as x-cron-secret, or send a valid Firebase ID token as Authorization: Bearer." },
                { status: 401 }
            );
        }

        if (!cronAuthorized && isBearer) {
            const { adminAuth } = await import("@/lib/firebase-admin");
            try {
                await adminAuth.verifyIdToken(authorization.slice(7).trim());
            } catch {
                return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            }
        }

        const body = await request.json().catch(() => ({}));
        const { checkAllActive } = body;

        const now = Date.now();
        let updatedCount = 0;
        let checkedCount = 0;

        if (checkAllActive) {
            // Get all users with Pro signals
            const proSnap = await adminDatabase.ref("telegramSignals").get();
            if (proSnap.exists()) {
                const proData = proSnap.val();
                for (const userId of Object.keys(proData)) {
                    if (checkedCount >= MAX_SIGNALS_TO_CHECK) break;
                    const userSignals = proData[userId];
                    for (const signalId of Object.keys(userSignals)) {
                        if (checkedCount >= MAX_SIGNALS_TO_CHECK) break;
                        const signal = userSignals[signalId];
                        const updated = await checkAndUpdateProSignal(userId, signal);
                        if (updated) updatedCount++;
                        checkedCount++;
                    }
                }
            }
        }

        return NextResponse.json({
            success: true,
            checked: checkedCount,
            updated: updatedCount,
            timestamp: now,
        });
    } catch (err) {
        console.error("[POST /api/pro-signals/auto-update]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to auto-update pro signals" },
            { status: 500 }
        );
    }
}

async function checkAndUpdateProSignal(userId: string, signal: ProSignal): Promise<boolean> {
    try {
        const activeStatuses = ["CREATED", "PENDING_ENTRY", "ENTRY_TRIGGERED", "TP1_HIT", "BE_PROFIT_LOCK", "TP2_HIT", "TP3_HIT", "TP4_HIT", "TP5_OPEN_RUNNER"];
        if (!activeStatuses.includes(signal.status)) return false;

        const priceData = await fetchLatestPrice(signal.symbol);
        if (!priceData) return false;

        const currentPrice = priceData.price;
        let newStatus: string | null = null;
        let tpHitIndex: number | null = null;
        let hitSl = false;

        const isBuy = signal.direction === "BUY";

        // Check SL hit
        if (signal.stopLoss > 0) {
            if (isBuy && currentPrice <= signal.stopLoss) {
                hitSl = true;
            } else if (!isBuy && currentPrice >= signal.stopLoss) {
                hitSl = true;
            }
        }

        // Check TP hits
        if (!hitSl) {
            for (const tp of signal.takeProfits) {
                if (tp.type === "PRICE" && tp.price && !tp.hit) {
                    if (isBuy && currentPrice >= tp.price) {
                        tpHitIndex = tp.index;
                        break;
                    } else if (!isBuy && currentPrice <= tp.price) {
                        tpHitIndex = tp.index;
                        break;
                    }
                }
            }
        }

        if (hitSl) {
            newStatus = "STOPPED";
        } else if (tpHitIndex) {
            switch (tpHitIndex) {
                case 1: newStatus = "TP1_HIT"; break;
                case 2: newStatus = "TP2_HIT"; break;
                case 3: newStatus = "TP3_HIT"; break;
                case 4: newStatus = "TP4_HIT"; break;
                default: newStatus = "TP5_OPEN_RUNNER"; break;
            }
        } else if (signal.status === "CREATED" || signal.status === "PENDING_ENTRY") {
            if (isBuy && currentPrice >= signal.entryMin && currentPrice <= signal.entryMax) newStatus = "ENTRY_TRIGGERED";
            else if (!isBuy && currentPrice >= signal.entryMin && currentPrice <= signal.entryMax) newStatus = "ENTRY_TRIGGERED";
        }

        // Force CLOSED if price reversed opposite direction after any TP was hit
        const anyTpHitBefore = (signal.takeProfits || []).some((t) => t.hit);
        const entryMid = signal.entry || ((signal.entryMin + signal.entryMax) / 2);
        const reversedOpposite = isBuy ? (currentPrice <= entryMid) : (currentPrice >= entryMid);
        if (!hitSl && anyTpHitBefore && reversedOpposite && newStatus !== "CLOSED" && newStatus !== "STOPPED" && signal.status !== "CLOSED" && signal.status !== "STOPPED" && signal.status !== "CANCELLED" && signal.status !== "EXPIRED") {
            newStatus = "CLOSED";
        }

        if (newStatus && newStatus !== signal.status) {
            // If reversed to CLOSED without a new TP/SL event this check, treat as CLOSE_SIGNAL
            const eventType: "TRIGGER_ENTRY" | "HIT_TP" | "HIT_SL" | "CLOSE_SIGNAL" =
                hitSl ? "HIT_SL" : (
                    tpHitIndex ? "HIT_TP" : (
                        newStatus === "CLOSED" && !hitSl && !tpHitIndex ? "CLOSE_SIGNAL" : "TRIGGER_ENTRY"
                    )
                );

            const transition = transitionSignalState(signal, eventType, {
                price: currentPrice,
                tpIndex: tpHitIndex ?? undefined,
            });

            if (transition.transitioned) {
                // If SL hit or final TP (TP5/TP5_OPEN_RUNNER) hit, mark as CLOSED (COMPLETED equivalent)
                let finalSignal = transition.updatedSignal;
                if (hitSl || (tpHitIndex && tpHitIndex >= 5)) {
                    finalSignal = { ...finalSignal, status: "CLOSED" };
                }
                await saveProSignal(userId, finalSignal);
                return true;
            }
        }

        return false;
    } catch (err) {
        console.error(`[checkAndUpdateProSignal] Error:`, err);
        return false;
    }
}

async function fetchLatestPrice(symbol: string): Promise<{ price: number } | null> {
    try {
        const cleanSymbol = symbol.replace("/", "") as unknown as import("@/lib/market-data/types").SupportedSymbol;
        const candles = await fetchCandles(cleanSymbol, "M1");
        if (candles && candles.length > 0) {
            return { price: candles[candles.length - 1].close };
        }
        return null;
    } catch {
        return null;
    }
}