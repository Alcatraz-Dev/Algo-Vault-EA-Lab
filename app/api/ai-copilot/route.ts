import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { fetchCandles } from "@/lib/market-data/normalizer";
import { detectRegime } from "@/lib/analytics/market-regime";
import { analyzeVolatility } from "@/lib/analytics/volatility";
import { analyzeVolume } from "@/lib/analytics/volume";
import { calculateVWAP, getVWAPPosition } from "@/lib/analytics/vwap";
import { detectLiquidity } from "@/lib/analytics/liquidity";
import { detectStructure, getOverallStructureBias } from "@/lib/analytics/market-structure";
import { calculateMarketScore } from "@/lib/analytics/market-score";
import { summarizeAnalysisWithFallback, getAIProvider } from "@/lib/ai";
import type { AnalysisSummaryInput } from "@/lib/ai/types";
import { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { isProUser } from "@/lib/ai-signals/access";
import type { AISignal } from "@/lib/ai-signals/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MarketDataEntry {
    error?: string;
    regime?: { regime: string; confidence: number };
    volatility?: { state: string };
    volume?: { state: string };
    vwapPos?: string;
    bias?: string;
    score?: { total: number };
    candleCount?: number;
}

interface TradingAccountSummary {
    balance?: number | string;
    equity?: number | string;
    margin?: number | string;
    accountId?: string;
}

function extractText(s: Awaited<ReturnType<typeof summarizeAnalysisWithFallback>> | string): string {
    return typeof s === "string" ? s : s.summary;
}

export async function POST(request: NextRequest) {
    try {
        const token = await authenticate(request);
        if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const uid = token.uid;
        const body = await request.json() as { question: string; symbol?: string; timeframe?: string };
        const { question, symbol, timeframe } = body;

        if (!question || !question.trim()) {
            return NextResponse.json({ error: "Question required" }, { status: 400 });
        }

        const isPro = await isProUser(uid);
        const q = question.toLowerCase().trim();
        const responses: Record<string, string> = {};
        const symbols: SupportedSymbol[] = symbol ? [symbol as SupportedSymbol] : ["XAUUSD", "EURUSD", "BTCUSD"];
        const tf: Timeframe = (timeframe as Timeframe) || "H1";

        // ── Load market data for all symbols ──
        const marketData: Record<string, MarketDataEntry> = {};
        for (const sym of symbols) {
            try {
                const candles = await fetchCandles(sym, tf);
                if (candles && candles.length >= 20) {
                    const regime = detectRegime(candles, tf);
                    const volatility = analyzeVolatility(candles);
                    const volume = analyzeVolume(candles);
                    const vwap = calculateVWAP(candles);
                    const vwapPos = getVWAPPosition(candles[candles.length - 1].close, vwap);
                    const liquidity = detectLiquidity(candles, tf);
                    const structure = detectStructure(candles, tf);
                    const bias = getOverallStructureBias(structure);
                    const score = calculateMarketScore(candles, tf);
                    marketData[sym] = { regime, volatility, volume, vwapPos, bias, score, candleCount: candles.length };
                }
            } catch {
                marketData[sym] = { error: "Data unavailable" };
            }
        }

        // ── Load user account data ──
        const accountSnap = await adminDatabase.ref(`trading_accounts/${uid}`).get();
        const accounts = accountSnap.exists()
            ? (accountSnap.val() as Record<string, TradingAccountSummary>)
            : {};
        const positionSnap = await adminDatabase.ref(`trading_positions/${uid}`).get();
        const userPositions = positionSnap.exists()
            ? (positionSnap.val() as Record<string, { accountId?: string }>)
            : {};

        const signalSnap = await adminDatabase.ref("aiSignals").get();
        const signals: AISignal[] = [];
        if (signalSnap.exists()) {
            signalSnap.forEach((child) => { const s = child.val() as AISignal | null; if (s && s.id) signals.push(s); });
        }
        const recentSignals = signals.filter((s) => s.createdAt > Date.now() - 30 * 86400000).slice(-50);

        const provider = getAIProvider();
        const aiCall = async (input: AnalysisSummaryInput) => {
            const result = await summarizeAnalysisWithFallback(input);
            return result.summary;
        };

        // ── Route questions ──
        if (q.includes("regime") || q.includes("market regime") || q.includes("trending") || q.includes("ranging") || q.includes("breakout")) {
            const summaries = Object.entries(marketData).map(([sym, data]) =>
                data.error ? `${sym}: unavailable` : `${sym}: ${data.regime?.regime ?? "?"} (${Math.round(data.regime?.confidence ?? 0)}% confidence), Volatility: ${data.volatility?.state ?? "?"}, Score: ${data.score?.total ?? 0}`
            );
            responses["market_regime"] = provider.id === "local-heuristic"
                ? `Based on real platform data:\n\n${summaries.join("\n\n")}\n\nThis analysis uses live market data from connected sources.`
                : await aiCall({ asset: symbols.join(", "), timeframe: tf, trend: "mixed", volatility: "mixed", bestSession: "", bestDay: "", strongestSetup: "", averageR: null, regime: "mixed" });
        }

        if (q.includes("risk") || q.includes("account health") || q.includes("dangerous") || q.includes("risk too high")) {
            const accountList = Object.entries(accounts).map(([id, acc]) => ({
                id,
                balance: Number(acc.balance || 0),
                equity: Number(acc.equity || 0),
                margin: Number(acc.margin || 0),
                positions: Object.keys(userPositions).filter((k: string) => userPositions[k]?.accountId === id).length,
            }));
            const totalBalance = accountList.reduce((s, a) => s + a.balance, 0);
            const totalPositions = accountList.reduce((s, a) => s + a.positions, 0);
            responses["account_risk"] = provider.id === "local-heuristic"
                ? `Account Risk Assessment (real data):\n\nTotal Balance: $${totalBalance.toLocaleString()}\nTotal Accounts: ${accountList.length}\nOpen Positions: ${totalPositions}\n\nRisk Metrics:\n- Position count is ${totalPositions === 0 ? "zero (safe)" : totalPositions > 10 ? "high - consider reducing" : "moderate"}\n- Balance range across accounts: ${accountList.map((a) => `$${a.balance.toLocaleString()}`).join(", ")}\n\nThis assessment uses real MT5 account data from your connected brokers.`
                : await aiCall({ asset: "Account", timeframe: tf, trend: totalPositions > 5 ? "high exposure" : "normal", volatility: "normal", bestSession: "", bestDay: "", strongestSetup: "", averageR: null, regime: totalPositions > 5 ? "high_risk" : "normal" });
        }

        if (q.includes("last 30 trades") || q.includes("trade history") || q.includes("performance") || q.includes("winning") || q.includes("losing")) {
            const recent = recentSignals.slice(-30);
            const wins = recent.filter((s) => s.result === "WIN").length;
            const losses = recent.filter((s) => s.result === "LOSS").length;
            const breakevens = recent.filter((s) => s.result === "BREAKEVEN").length;
            const winRate = recent.length > 0 ? ((wins / recent.length) * 100).toFixed(1) : "0";
            const avgR = recent.length > 0 ? (recent.reduce((s, sig) => s + Number(sig.resultR || 0), 0) / recent.length).toFixed(2) : "0";
            responses["trade_performance"] = provider.id === "local-heuristic"
                ? `Trade Performance Analysis (last 30 signals, real data):\n\nTotal Signals: ${recent.length}\nWins: ${wins} (${winRate}%)\nLosses: ${losses}\nBreakevens: ${breakevens}\nAverage R: ${avgR}R\n\nThis analysis uses actual signal data from your AlgoVault account.`
                : await aiCall({ asset: "Account", timeframe: tf, trend: wins > losses ? "positive" : "negative", volatility: "normal", bestSession: "", bestDay: "", strongestSetup: "", averageR: parseFloat(avgR), regime: wins > losses ? "bullish_bias" : "bearish_bias" });
        }

        if (q.includes("strategy") || q.includes("best") || q.includes("what works")) {
            const regimeCounts: Record<string, number> = {};
            recentSignals.forEach((s) => { const regime = s.marketRegime || "unknown"; regimeCounts[regime] = (regimeCounts[regime] || 0) + 1; });
            const topRegime = Object.entries(regimeCounts).sort((a, b) => b[1] - a[1])[0];
            responses["strategy_recommendation"] = provider.id === "local-heuristic"
                ? `Strategy Recommendation Based on Real Data:\n\nTop Regime: ${topRegime ? topRegime[0] : "Unknown"} (${topRegime ? topRegime[1] : 0} signals)\n\nFollow the dominant regime and maintain proper risk management.`
                : await aiCall({ asset: symbols.join(", "), timeframe: tf, trend: topRegime?.[0] || "unknown", volatility: "normal", bestSession: "", bestDay: "", strongestSetup: "", averageR: null, regime: topRegime?.[0] || "unknown" });
        }

        if (q.includes("why") || q.includes("why is") || q.includes("reason") || q.includes("explain")) {
            const analysis = Object.entries(marketData).map(([sym, data]) => {
                if (data.error) return `${sym}: Data unavailable`;
                return `${sym}: ${data.bias ?? "?"} bias, ${data.regime?.regime ?? "?"}, Volatility: ${data.volatility?.state ?? "?"}, Score: ${data.score?.total ?? 0}`;
            }).join("\n");
            responses["signal_reasoning"] = provider.id === "local-heuristic"
                ? `Signal Analysis (real data):\n\n${analysis}\n\nAll analysis uses real market data - no fabricated values.`
                : await aiCall({ asset: symbols.join(", "), timeframe: tf, trend: "analysis", volatility: "normal", bestSession: "", bestDay: "", strongestSetup: "", averageR: null, regime: "analysis" });
        }

        if (Object.keys(responses).length === 0) {
            responses["overview"] = provider.id === "local-heuristic"
                ? `AlgoVault AI Copilot Response\n\nI analyzed your real platform data:\n\n${Object.entries(marketData).map(([sym, data]) => `${sym}: ${data.error || `${data.regime?.regime ?? "?"}, ${data.volatility?.state ?? "?"} volatility, Score ${data.score?.total ?? 0}`}`).join("\n")}\n\nYour accounts show ${Object.keys(accounts).length} connected MT5 accounts with ${Object.keys(userPositions).length} open positions.\n\n${recentSignals.length} recent signals in the last 30 days.\n\nAsk about: market regime, account risk, trade performance, strategy recommendations, or signal analysis.`
                : await aiCall({ asset: symbols.join(", "), timeframe: tf, trend: "analysis", volatility: "normal", bestSession: "", bestDay: "", strongestSetup: "", averageR: null, regime: "analysis" });
        }

        return NextResponse.json({ success: true, responses, marketData, accounts: Object.keys(accounts).length, positions: Object.keys(userPositions).length, signals: recentSignals.length, isPro }, { status: 200 });
    } catch (err: unknown) {
        console.error("[ai-copilot]", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "AI Copilot failed" }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    try {
        const token = await authenticate(request);
        if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const uid = token.uid;
        const isPro = await isProUser(uid);
        const accountSnap = await adminDatabase.ref(`trading_accounts/${uid}`).get();
        const accounts = accountSnap.exists() ? accountSnap.val() : {};
        const signalSnap = await adminDatabase.ref("aiSignals").get();
        const signals: AISignal[] = [];
        if (signalSnap.exists()) {
            signalSnap.forEach((child) => { const s = child.val() as AISignal | null; if (s && s.id) signals.push(s); });
        }
        const recentSignals = signals.filter((s) => s.createdAt > Date.now() - 7 * 86400000).slice(-30);

        return NextResponse.json({ success: true, isPro, accounts: Object.keys(accounts).length, positions: Object.keys(accounts).length, recentSignals: recentSignals.length, supportedSymbols: ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "BTCUSD", "NAS100", "US30"] }, { status: 200 });
    } catch (err: unknown) {
        console.error("[ai-copilot GET]", err);
        return NextResponse.json({ error: "Failed to load copilot data" }, { status: 500 });
    }
}
