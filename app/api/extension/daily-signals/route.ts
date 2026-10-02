import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { loadSignalConfig, scanSymbol, type ScanDiagnostic } from "@/lib/ai-signals/engine";
import { getSymbolSpec } from "@/lib/ai-signals/symbol-specs";
import { passesQualityFilter } from "@/lib/ai-signals/quality-filter";
import type { AISignal } from "@/lib/ai-signals/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
};

export async function OPTIONS() {
    return NextResponse.json(null, { status: 204, headers: corsHeaders });
}

const MAX_INSTALL_ID_LENGTH = 128;
const INSTALL_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_SYMBOLS = 3;
/** Hard cap so a corrupted config can never hand out unlimited signals. */
const FALLBACK_MAX_LIMIT = 10;

function validInstallId(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const id = raw.trim();
    return id.length >= 8 && id.length <= MAX_INSTALL_ID_LENGTH && INSTALL_ID_PATTERN.test(id) ? id : null;
}

/** Effective daily cap, always sane even if the admin config is broken. */
function effectiveLimit(freeSignalsPerDay: unknown): number {
    const n = Number(freeSignalsPerDay);
    if (!Number.isFinite(n)) return 3;
    return Math.max(0, Math.min(FALLBACK_MAX_LIMIT, Math.floor(n)));
}

/* ── quota ledger ────────────────────────────────────────────────────── */

/**
 * A per-day usage ledger stored at exactly ONE node:
 *   • anonymous install → extensionDailySignals/{installId}
 *   • logged-in user    → users/{uid}/extensionDailySignals
 *
 * Shape (single atomic document — counter and signals can never diverge):
 *   { day: "YYYY-MM-DD", used: 0, signals: [...], symbols: [...] }
 *
 * Legacy layouts are read defensively for migration, but every write produces
 * THIS shape, so `used` is always a real number and the limit always applies.
 */
interface UsageLedger {
    day: string;
    used: number;
    signals: StoredSignal[];
    symbols: string[];
}

function installQuotaRef(installId: string) {
    return adminDatabase.ref(`extensionDailySignals/${installId}`);
}

function userQuotaRef(uid: string) {
    return adminDatabase.ref(`users/${uid}/extensionDailySignals`);
}

interface StoredSignal {
    symbol: string;
    direction: string;
    timeframe: string;
    entry: number;
    stopLoss: number;
    takeProfit1: number;
    takeProfit2: number;
    takeProfit3: number;
    confidence: number;
    setup: string;
    reasoning: string;
    riskReward?: number;
    chartLevels?: Array<{ kind: string; label: string; price: number }>;
    createdAt: number;
}

function todayStamp(): string {
    return new Date().toISOString().slice(0, 10);
}

/** Coerce any stored shape (including legacy ones) into today's ledger. */
function coerceLedger(raw: unknown, day: string): UsageLedger {
    if (!raw || typeof raw !== "object") return { day, used: 0, signals: [], symbols: [] };
    const rec = raw as Record<string, unknown>;

    // Legacy: counter was a bare number under `users/{uid}/extensionDailySignals/{day}`
    // and "signals" lived as a sibling child of it — that shape made
    // Number(used) NaN and reset the count. Read it one last time here.
    const legacySignals = Array.isArray(rec.signals) ? (rec.signals as StoredSignal[]) : [];

    const storedDay = typeof rec.day === "string" ? rec.day : day;
    if (storedDay !== day) {
        // Different day — the allowance resets; keep nothing but the symbols pick.
        return {
            day,
            used: 0,
            signals: [],
            symbols: Array.isArray(rec.symbols) ? (rec.symbols as string[]).slice(0, MAX_SYMBOLS) : [],
        };
    }

    let used = Number(rec.used);
    if (!Number.isFinite(used) || used < 0) used = legacySignals.length; // repair NaN from the legacy bug
    return {
        day,
        used: Math.floor(used),
        signals: legacySignals,
        symbols: Array.isArray(rec.symbols) ? (rec.symbols as string[]).slice(0, MAX_SYMBOLS) : [],
    };
}

/** Symbol aliases accepted from the extension (chart uses the same table). */
const SYMBOL_ALIASES: Record<string, string> = {
    XAUUSD: "XAUUSD", GOLD: "XAUUSD",
    XAGUSD: "XAGUSD", SILVER: "XAGUSD",
    EURUSD: "EURUSD", GBPUSD: "GBPUSD", USDJPY: "USDJPY", USDCHF: "USDCHF",
    AUDUSD: "AUDUSD", NZDUSD: "NZDUSD",
    US30: "US30", DJIA: "US30", DOW: "US30",
    NAS100: "NAS100", NDX: "NAS100", NASDAQ: "NAS100",
    SPX500: "SPX500", SP500: "SPX500", US500: "SPX500",
    BTCUSD: "BTCUSD", BTCUSDT: "BTCUSD", BTC: "BTCUSD",
    ETHUSD: "ETHUSD", ETHUSDT: "ETHUSD", ETH: "ETHUSD",
};

/** Free-tier daily signals always scan the 15-minute chart (same as web). */
const DAILY_SIGNAL_TIMEFRAME = "M15";

/**
 * Map an extension symbol to a canonical data-source symbol, normalising
 * legacy aliases exactly like the chart's symbol normaliser.
 */
function canonicalSymbol(raw: string): string | null {
    const sym = SYMBOL_ALIASES[String(raw ?? "").toUpperCase()];
    if (sym) return sym;
    return getSymbolSpec(String(raw ?? "").toUpperCase()) ? String(raw).toUpperCase() : null;
}

/**
 * Generate the daily signals with the SAME deterministic engine the web app's
 * AI Signals use (scanSymbol → chart confluence + structure + liquidity +
 * quality filter). No LLM: identical candles always produce identical
 * signals, every level is one the chart actually draws, and nothing can be
 * invented.
 */
async function generateEngineSignals(symbols: string[]): Promise<{ signals: StoredSignal[]; diagnostics: ScanDiagnostic[] }> {
    const config = await loadSignalConfig();
    const diagnostics: ScanDiagnostic[] = [];
    const signals: StoredSignal[] = [];

    for (const raw of symbols) {
        const symbol = canonicalSymbol(raw);
        if (!symbol) {
            diagnostics.push({ symbol: raw, timeframe: DAILY_SIGNAL_TIMEFRAME, reason: "Unknown symbol — no spec" });
            continue;
        }
        try {
            const partials = await scanSymbol(symbol, config, [DAILY_SIGNAL_TIMEFRAME], diagnostics);
            if (partials.length === 0) continue;
            // Highest-confidence partial wins (one signal per symbol).
            partials.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
            const best = partials[0];
            const spec = getSymbolSpec(symbol);
            const round = (p: number) => parseFloat(spec ? p.toFixed(spec.digits) : p.toPrecision(6));
            signals.push({
                symbol,
                direction: String(best.direction ?? "BUY"),
                timeframe: String(best.timeframe ?? DAILY_SIGNAL_TIMEFRAME),
                entry: round(best.entry ?? 0),
                stopLoss: round(best.stopLoss ?? 0),
                takeProfit1: round(best.tp1 ?? 0),
                takeProfit2: round(best.tp2 ?? 0),
                takeProfit3: round(best.tp3 ?? 0),
                confidence: Math.max(0, Math.min(100, Math.round(best.confidence ?? 0))),
                setup: `${best.direction} ${symbol} — ${best.marketRegime ?? ""} regime`.trim(),
                reasoning: String(best.reasoning ?? "").slice(0, 400),
                riskReward: Number(best.riskReward ?? 0),
                chartLevels: Array.isArray(best.chartLevels) ? best.chartLevels.slice(0, 12) : undefined,
                createdAt: Date.now(),
            });
        } catch (err) {
            console.error(`Engine scan failed for ${symbol}:`, err);
            diagnostics.push({ symbol, timeframe: DAILY_SIGNAL_TIMEFRAME, reason: `Scan error: ${err instanceof Error ? err.message : "unknown"}` });
        }
    }

    return { signals, diagnostics };
}

/**
 * GET /api/extension/daily-signals?installId=…
 *
 * Free daily quota state for the Chrome extension in anonymous-install mode
 * (no Firebase session). The counter lives SERVER-SIDE keyed by a random
 * install id the client persists on the AlgoVault site (localStorage), so
 * removing/reinstalling the extension no longer resets the 3 free daily
 * signals. Logged-in users are keyed by uid instead, matching the web app.
 */
export async function GET(request: NextRequest) {
    const user = await authenticate(request);
    const installId = validInstallId(request.nextUrl.searchParams.get("installId"));
    if (!user && !installId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    try {
        const config = await loadSignalConfig();
        const limit = effectiveLimit(config.freeSignalsPerDay);
        const day = todayStamp();

        const snap = user
            ? await userQuotaRef(user.uid).get()
            : await installQuotaRef(installId!).get();
        const ledger = coerceLedger(snap.val(), day);
        const used = Math.min(limit, ledger.used);

        return NextResponse.json(
            {
                success: true,
                used,
                limit,
                remaining: Math.max(0, limit - used),
                day,
                mode: user ? ("user" as const) : ("install" as const),
                signals: ledger.signals,
                symbols: ledger.symbols,
            },
            { headers: corsHeaders }
        );
    } catch (err) {
        console.error("Extension daily signals GET error:", err);
        return NextResponse.json({ error: "Failed to load quota" }, { status: 500, headers: corsHeaders });
    }
}

/**
 * POST /api/extension/daily-signals
 *
 * Atomically reserves ONE quota unit per request (regardless of how many
 * symbols were scanned) with a Firebase transaction, then generates the
 * signals with the SAME deterministic engine as the web AI Signals and
 * persists them in the SAME ledger document the counter lives in. The
 * reservation is refunded when nothing usable is produced or generation
 * fails. Concurrent tabs can no longer double-spend the daily allowance.
 */
export async function POST(request: NextRequest) {
    const user = await authenticate(request);
    let body: Record<string, unknown> = {};
    try {
        body = (await request.json()) as Record<string, unknown>;
    } catch {
        body = {};
    }
    const installId = validInstallId(body.installId);
    if (!user && !installId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    const symbols = Array.isArray(body.symbols)
        ? Array.from(
              new Set(
                  body.symbols
                      .map((s) => String(s).trim().toUpperCase())
                      .filter((s) => /^[A-Z0-9._-]{1,20}$/.test(s))
              )
          ).slice(0, MAX_SYMBOLS)
        : [];
    if (symbols.length === 0) {
        return NextResponse.json({ error: "Pick at least one symbol" }, { status: 400, headers: corsHeaders });
    }

    const config = await loadSignalConfig();
    if (!config.enabled) {
        return NextResponse.json({ error: "Signal generation is currently disabled" }, { status: 400, headers: corsHeaders });
    }
    const limit = effectiveLimit(config.freeSignalsPerDay);
    const day = todayStamp();
    const quotaRef = user ? userQuotaRef(user.uid) : installQuotaRef(installId!);

    // ── Atomic reservation (transaction) ────────────────────────────────
    // The transaction writes the full ledger shape, so `used` stays a clean
    // number and the limit check can never be bypassed by a corrupt document.
    const tx = await quotaRef.transaction((current) => {
        const cur = coerceLedger(current, day);
        if (cur.used >= limit) return undefined; // abort — quota exhausted
        return { day, used: cur.used + 1, signals: cur.signals, symbols: symbols.length > 0 ? symbols : cur.symbols };
    });
    if (!tx.committed) {
        return NextResponse.json(
            { error: `Daily free limit reached (${limit}/${limit}). Come back tomorrow.` },
            { status: 429, headers: corsHeaders }
        );
    }
    const reservedAfter = coerceLedger(tx.snapshot.val(), day).used;

    /** Release the reserved unit (best effort) and report failure. */
    async function refund(): Promise<void> {
        try {
            await quotaRef.transaction((current) => {
                const cur = coerceLedger(current, day);
                if (cur.used <= 0) return current; // nothing to refund
                return { day, used: cur.used - 1, signals: cur.signals, symbols: cur.symbols };
            });
        } catch {
            /* best effort */
        }
    }

    try {
        // Same deterministic engine as the web AI Signals: chart confluence
        // (session levels, pivots, VWAP, EMA stack, EQH/EQL) + market
        // structure + liquidity + quality filter. No LLM in the loop.
        const { signals, diagnostics } = await generateEngineSignals(symbols);

        // Same read-time quality gate the web scan applies: minimum RR and
        // scan confidence floor — the daily free signals never bypass it.
        const recentSnap = await adminDatabase.ref("aiSignals").get();
        const recentSignals: Array<{ symbol?: string; direction?: string; timeframe?: string; createdAt?: number; status?: string }> = [];
        recentSnap.forEach((child: { val: () => Record<string, unknown> }) => {
            recentSignals.push(child.val() as { symbol?: string; direction?: string; timeframe?: string; createdAt?: number; status?: string });
        });

        const qualified = signals.filter((s) => {
            const partial = {
                symbol: s.symbol,
                direction: s.direction === "SELL" ? "SELL" : "BUY",
                timeframe: s.timeframe,
                entry: s.entry,
                stopLoss: s.stopLoss,
                riskReward: s.riskReward ?? 0,
                confidence: s.confidence,
                marketRegime: undefined as unknown as AISignal["marketRegime"],
            };
            const result = passesQualityFilter(partial as unknown as Partial<AISignal>, config, recentSignals as unknown as AISignal[]);
            if (!result.passed) {
                diagnostics.push({ symbol: s.symbol, timeframe: s.timeframe, reason: result.reasons.join("; ") });
                return false;
            }
            return true;
        });

        if (qualified.length === 0) {
            // Nothing usable generated — give the reserved unit back.
            await refund();
            return NextResponse.json(
                {
                    success: true,
                    signals: [],
                    generated: 0,
                    remaining: Math.max(0, limit - (reservedAfter - 1)),
                    note: "No valid setups right now — the engine found nothing worth taking on these symbols. Try again later or change symbols.",
                },
                { headers: corsHeaders }
            );
        }

        // ── Persist signals INTO the same ledger document the counter lives
        //    in, so they survive extension removal/reinstall and the counter
        //    can never be clobbered by a sibling write.
        await quotaRef.transaction((current) => {
            const cur = coerceLedger(current, day);
            const merged = [...cur.signals, ...qualified].slice(-limit);
            return { day, used: cur.used, signals: merged, symbols: cur.symbols.length > 0 ? cur.symbols : symbols };
        });

        return NextResponse.json(
            {
                success: true,
                signals: qualified,
                generated: qualified.length,
                used: Math.min(limit, reservedAfter),
                remaining: Math.max(0, limit - reservedAfter),
                day,
            },
            { headers: corsHeaders }
        );
    } catch (err) {
        // Generation failed — release the reservation so the user isn't charged.
        await refund();
        console.error("Extension daily signals POST error:", err);
        return NextResponse.json({ error: "Failed to generate signals" }, { status: 500, headers: corsHeaders });
    }
}
