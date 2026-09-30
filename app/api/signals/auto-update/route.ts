import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { AISignal, SignalStatus, SignalEvent } from "@/lib/ai-signals/types";
import type { ProSignal } from "@/features/telegram-signals/types";
import { saveProSignal } from "@/features/telegram-signals/signals/signal-engine";
import { transitionSignalState } from "@/features/telegram-signals/lifecycle/state-machine";
import { tradingViewLivePriceCache } from "@/lib/market-data/tradingview-live";
import { calculateSignalResult } from "@/lib/ai-signals/results";
import { recordSignalEvent } from "@/lib/ai-signals/events";

const MAX_SIGNALS_TO_CHECK = 200;

/**
 * Signal auto-update sweep — invoked by a cron/worker (vercel.json, every 5 min)
 * OR by an authenticated user from the Signals page ("Scan" button, which sends
 * `Authorization: Bearer <idToken>`).
 *
 * Auth: accepts any of —
 *   - Vercel's cron runner (user-agent "vercel-cron")
 *   - `x-cron-secret` (or `?secret=`) matching CRON_SECRET
 *   - a valid Firebase ID token as `Authorization: Bearer <idToken>`
 * If CRON_SECRET is unset the cron paths are simply not available (the bearer
 * path still works); nothing runs unauthenticated.
 */
export async function POST(request: NextRequest) {
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

    try {
        const body = await request.json().catch(() => ({}));
        const { signalIds, checkAllActive } = body;

        const now = Date.now();
        let updatedCount = 0;
        let checkedCount = 0;

        if (checkAllActive) {
            // Fetch all active signals from database
            const snap = await adminDatabase.ref("aiSignals").get();
            if (snap.exists()) {
                const allSignals: AISignal[] = [];
                snap.forEach((child) => {
                    const signal = child.val() as AISignal;
                    allSignals.push(signal);
                });

                // Filter to active signals that need monitoring
                const activeSignals = allSignals.filter((s) => 
                    ["ACTIVE", "READY", "TP1_HIT", "TP2_HIT", "TP3_HIT", "RUNNER", "PENDING_ENTRY", "ENTRY_TRIGGERED"].includes(s.status)
                ).slice(0, MAX_SIGNALS_TO_CHECK);

                // Batch: one parallel price lookup per symbol instead of a
                // serial round-trip per signal — the sweep completes in a
                // fraction of the time, so SL/TP transitions land sooner.
                const symbols = Array.from(new Set(activeSignals.map((s) => s.symbol)));
                const priceBySymbol = await fetchPricesForSymbols(symbols);

                for (const signal of activeSignals) {
                    const currentPrice = priceBySymbol.get(signal.symbol);
                    const updated = currentPrice != null
                        ? await checkAndUpdateSignal(signal, currentPrice)
                        : false;
                    if (updated) updatedCount++;
                    checkedCount++;
                }
            }
        } else if (signalIds && Array.isArray(signalIds)) {
            const signalIdsList = signalIds.slice(0, MAX_SIGNALS_TO_CHECK) as string[];
            const signalSnaps = await Promise.all(
                signalIdsList.map((signalId) => adminDatabase.ref(`aiSignals/${signalId}`).get())
            );
            const loaded: AISignal[] = signalSnaps
                .filter((snap) => snap.exists())
                .map((snap) => snap.val() as AISignal);
            const priceBySymbol = await fetchPricesForSymbols(Array.from(new Set(loaded.map((s) => s.symbol))));
            for (const signal of loaded) {
                const currentPrice = priceBySymbol.get(signal.symbol);
                const updated = currentPrice != null
                    ? await checkAndUpdateSignal(signal, currentPrice)
                    : false;
                if (updated) updatedCount++;
                checkedCount++;
            }
        }

        // Also check Pro signals
        const proSnap = await adminDatabase.ref("telegramSignals").get();
        if (proSnap.exists()) {
            const proData = proSnap.val();
            const proSignals: Array<{ userId: string; signal: ProSignal }> = [];
            for (const userId of Object.keys(proData)) {
                for (const signalId of Object.keys(proData[userId])) {
                    if (proSignals.length >= MAX_SIGNALS_TO_CHECK) break;
                    const signal = proData[userId][signalId];
                    if (signal) proSignals.push({ userId, signal });
                }
            }

            const priceBySymbol = await fetchPricesForSymbols(
                Array.from(new Set(proSignals.map(({ signal }) => signal.symbol)))
            );

            for (const { userId, signal } of proSignals) {
                const currentPrice = priceBySymbol.get(signal.symbol);
                const updated = currentPrice != null
                    ? await checkAndUpdateProSignal(userId, signal, currentPrice)
                    : false;
                if (updated) updatedCount++;
                checkedCount++;
            }
        }

        return NextResponse.json({
            success: true,
            checked: checkedCount,
            updated: updatedCount,
            timestamp: now,
        });
    } catch (err) {
        console.error("[POST /api/signals/auto-update]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to auto-update signals" },
            { status: 500 }
        );
    }
}

async function checkAndUpdateSignal(signal: AISignal, currentPrice: number): Promise<boolean> {
    try {
        const now = Date.now();

        function statusToEventType(status: string): SignalEvent["eventType"] {
            switch (status) {
                case "TP1_HIT": return "TP1_HIT";
                case "TP2_HIT": return "TP2_HIT";
                case "TP3_HIT": return "TP3_HIT";
                case "STOPPED": return "STOP_LOSS_HIT";
                case "ACTIVE": return "ENTRY_REACHED";
                case "COMPLETED": return "COMPLETED";
                case "CANCELLED": return "CANCELLED";
                case "EXPIRED": return "EXPIRED";
                default: return "STATUS_CHANGE";
            }
        }

        // Price is resolved once per symbol by the batched sweep (real live
        // quote — Biquote forming candle or TradingView scanner). No fallback
        // fabrication: if no price is available the signal is skipped.
        let newStatus: SignalStatus | null = null;
        let hitTpIndex: number | null = null;
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
            if (signal.tp1 && !signal.tp1Hit) {
                if (isBuy && currentPrice >= signal.tp1) hitTpIndex = 1;
                else if (!isBuy && currentPrice <= signal.tp1) hitTpIndex = 1;
            }
            if (signal.tp2 && !signal.tp2Hit && !hitTpIndex) {
                if (isBuy && currentPrice >= signal.tp2) hitTpIndex = 2;
                else if (!isBuy && currentPrice <= signal.tp2) hitTpIndex = 2;
            }
            if (signal.tp3 && !signal.tp3Hit && !hitTpIndex) {
                if (isBuy && currentPrice >= signal.tp3) hitTpIndex = 3;
                else if (!isBuy && currentPrice <= signal.tp3) hitTpIndex = 3;
            }
        }

        // Determine new status
        if (hitSl) {
            newStatus = "STOPPED";
        } else if (hitTpIndex === 1) {
            newStatus = "TP1_HIT";
        } else if (hitTpIndex === 2) {
            newStatus = "TP2_HIT";
        } else if (hitTpIndex === 3) {
            newStatus = "TP3_HIT";
        } else if (signal.status === "READY" || signal.status === "PENDING_ENTRY") {
            // Check if entry triggered
            if (isBuy && currentPrice >= signal.entry) newStatus = "ACTIVE";
            else if (!isBuy && currentPrice <= signal.entry) newStatus = "ACTIVE";
        }

        if (newStatus && newStatus !== signal.status) {
            const updates: Partial<AISignal> = {
                status: newStatus,
                currentPrice,
                updatedAt: now,
            };

            // Track TP hits
            if (hitTpIndex === 1) updates.tp1Hit = true;
            if (hitTpIndex === 2) updates.tp2Hit = true;
            if (hitTpIndex === 3) updates.tp3Hit = true;

            // Outcomes must be computed against the POST-transition signal
            // (merged status + tp flags), never the stale pre-update snapshot —
            // otherwise e.g. a TP3 hit on a signal whose tp1Hit/tp2Hit flags
            // were set on a previous sweep resolves as PENDING instead of WIN.
            const computeOutcome = (status: SignalStatus) =>
                calculateSignalResult({
                    ...signal,
                    ...updates,
                    status,
                    tp1Hit: signal.tp1Hit || updates.tp1Hit === true,
                    tp2Hit: signal.tp2Hit || updates.tp2Hit === true,
                    tp3Hit: signal.tp3Hit || updates.tp3Hit === true,
                });

            // Did the trade ever actually enter? (READY/PENDING/FORMING signals
            // swept out to SL never became a position.)
            const enteredStatuses: SignalStatus[] = ["ENTRY_TRIGGERED", "ACTIVE", "TP1_HIT", "TP2_HIT", "TP3_HIT", "RUNNER"];
            const hadEntered = enteredStatuses.includes(signal.status) || signal.tp1Hit === true || signal.tp2Hit === true || signal.tp3Hit === true;

            if (hitSl) {
                if (hadEntered) {
                    // Entered, then stopped out: honest STOPPED outcome. With
                    // no TPs banked the results engine resolves this to -1R
                    // LOSS; with TP1 banked (SL moved to BE) it resolves to
                    // +0.3·TP1 — the trade-management close model.
                    const outcome = computeOutcome("STOPPED");
                    updates.status = "STOPPED";
                    newStatus = "STOPPED";
                    updates.result = outcome.result;
                    updates.resultR = outcome.resultR;
                    updates.profitPoints = outcome.profitPoints;
                    updates.closedAt = now;
                } else {
                    // Entry never triggered — no trade happened. Storing a
                    // COMPLETED/STOPPED record here would resolve as a -1R
                    // "trade" in statistics and inflate the win rate.
                    updates.status = "CANCELLED";
                    newStatus = "CANCELLED";
                    updates.result = "CANCELLED";
                    updates.resultR = 0;
                    updates.profitPoints = 0;
                    updates.closedAt = now;
                }
            } else if (hitTpIndex === 3) {
                // Final TP hit → completed
                const outcome = computeOutcome("COMPLETED");
                updates.status = "COMPLETED";
                newStatus = "COMPLETED";
                updates.result = outcome.result;
                updates.resultR = outcome.resultR;
                updates.profitPoints = outcome.profitPoints;
                updates.closedAt = now;
            } else if (hitTpIndex === 1 || hitTpIndex === 2) {
                // Interim result — trade still running (remaining TPs pending).
                const outcome = computeOutcome(updates.status as SignalStatus);
                updates.result = outcome.result;
                updates.resultR = outcome.resultR;
                updates.profitPoints = outcome.profitPoints;
            } else if (newStatus === "ACTIVE") {
                // Entry just triggered — nothing resolved yet.
                updates.result = "PENDING";
                updates.resultR = 0;
            }

            // Complete when all TPs hit OR price reversed opposite direction after any TP hit
            const hadAnyTp = signal.tp1Hit || signal.tp2Hit || signal.tp3Hit || hitTpIndex !== null;
            const allHit = (signal.tp1Hit || hitTpIndex === 1) && (signal.tp2Hit || hitTpIndex === 2) && (signal.tp3Hit || hitTpIndex === 3);
            const reversed = isBuy ? (currentPrice <= signal.entry) : (currentPrice >= signal.entry);
            if (!hitSl && hadAnyTp && (allHit || reversed)) {
                if (updates.status !== "COMPLETED" && updates.status !== "STOPPED") {
                    const outcome = computeOutcome("COMPLETED");
                    updates.result = outcome.result;
                    updates.resultR = outcome.resultR;
                    updates.profitPoints = outcome.profitPoints;
                    updates.closedAt = now;
                    updates.status = "COMPLETED";
                    newStatus = "COMPLETED";
                }
            }

            await adminDatabase.ref(`aiSignals/${signal.id}`).update(updates);

            // Record event
            await recordSignalEvent(signal, statusToEventType(newStatus), currentPrice);

            return true;
        }

        return false;
    } catch (err) {
        console.error(`[checkAndUpdateSignal] Error for ${signal.id}:`, err);
        return false;
    }
}

async function checkAndUpdateProSignal(userId: string, signal: ProSignal, currentPrice: number): Promise<boolean> {
    try {
        // Pro signals have different status values
        const activeStatuses = ["CREATED", "PENDING_ENTRY", "ENTRY_TRIGGERED", "TP1_HIT", "BE_PROFIT_LOCK", "TP2_HIT", "TP3_HIT", "TP4_HIT", "TP5_OPEN_RUNNER"];
        if (!activeStatuses.includes(signal.status)) return false;

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

        if (newStatus && newStatus !== signal.status) {
            const eventType: "TRIGGER_ENTRY" | "HIT_TP" | "HIT_SL" =
                hitSl ? "HIT_SL" : (
                    tpHitIndex ? "HIT_TP" : "TRIGGER_ENTRY"
                );

            const transition = transitionSignalState(signal, eventType, {
                price: currentPrice,
                tpIndex: tpHitIndex ?? undefined,
            });

            if (transition.transitioned) {
                // Write via saveProSignal so the payload is sanitized for
                // Firebase (raw .set() rejects nested undefined values).
                await saveProSignal(userId, transition.updatedSignal);
                return true;
            }
        }

        return false;
    } catch (err) {
        console.error(`[checkAndUpdateProSignal] Error:`, err);
        return false;
    }
}

/**
 * Resolve the latest real price for each symbol in parallel via the shared
 * live-price resolver (fresh Biquote forming M1 candle → TradingView
 * scanner). Symbols without a resolvable live price are simply omitted —
 * their signals are skipped this sweep, never priced with fabricated data.
 */
async function fetchPricesForSymbols(symbols: string[]): Promise<Map<string, number>> {
    const priceBySymbol = new Map<string, number>();
    const uniqueSymbols = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)));
    if (uniqueSymbols.length === 0) return priceBySymbol;

    const results = await Promise.allSettled(
        uniqueSymbols.map(async (symbol) => ({
            symbol,
            quote: await tradingViewLivePriceCache.get(symbol),
        }))
    );

    for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const { symbol, quote } = result.value;
        if (quote && Number.isFinite(quote.price) && quote.price > 0) {
            priceBySymbol.set(symbol, quote.price);
        }
    }
    return priceBySymbol;
}