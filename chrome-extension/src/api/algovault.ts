import { getAuthToken, getSettings, getServerInstallId } from "@/storage/storage";
import type {
  ChartAnalysis,
  Signal,
  GatewayStatus,
  AISignal,
  ChatMessage,
} from "@/types";

async function getBaseUrl(): Promise<string> {
  const settings = await getSettings();
  return settings.algovaultUrl;
}

const EXT_PREFIX = "[AlgoVault Extension]";

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function apiGet<T>(path: string): Promise<T> {
  const base = await getBaseUrl();
  const headers = await authHeaders();
  console.log(`${EXT_PREFIX} GET ${base}${path}`);
  const res = await fetch(`${base}${path}`, { headers, method: "GET" });
  console.log(`${EXT_PREFIX} GET ${base}${path} -> ${res.status}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error ${res.status}`);
  }
  return res.json();
}

async function apiPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const base = await getBaseUrl();
  const headers = await authHeaders();
  console.log(`${EXT_PREFIX} POST ${base}${path}`, body);
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  console.log(`${EXT_PREFIX} POST ${base}${path} -> ${res.status}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `API error ${res.status}`);
  }
  return res.json();
}

export async function checkHealth(): Promise<boolean> {
  try {
    const base = await getBaseUrl();
    // Probe the unauthenticated liveness endpoint. Checking authenticated
    // routes here (e.g. /api/account-health) produced 401 noise whenever the
    // stored token was missing or expired — reachability needs no session.
    const res = await fetch(`${base}/api/health`, { method: "GET" });
    return res.ok || res.status === 401;
  } catch {
    return false;
  }
}

export async function getGatewayStatus(): Promise<GatewayStatus> {
  const data = await apiGet<{
    success: boolean;
    accounts: Array<{
      accountId: string;
      // Server historically sent `mt5Account`; newer deployments send
      // `accountNumber` too. Accept both so the MT5 login number always
      // renders in the Trade Ticket account selector.
      accountNumber?: string;
      mt5Account?: string;
      broker?: string;
      server?: string;
      balance?: number;
      equity?: number;
      currency?: string;
      margin?: number;
      freeMargin?: number;
      marginLevel?: number;
      positionsCount?: number;
      pendingOrdersCount?: number;
      status?: string;
      lastHeartbeatAt?: number;
    }>;
    license?: { valid?: boolean };
  }>("/api/trading/gateway/status");
  return {
    connected: data.accounts?.length > 0,
    accounts: (data.accounts || []).map((a) => ({
      accountId: a.accountId,
      accountNumber: a.accountNumber || a.mt5Account || "",
      broker: a.broker || "",
      server: a.server || "",
      balance: a.balance ?? 0,
      equity: a.equity ?? 0,
      currency: a.currency || "",
      margin: a.margin,
      freeMargin: a.freeMargin,
      marginLevel: a.marginLevel,
      positionsCount: a.positionsCount,
      pendingOrdersCount: a.pendingOrdersCount,
      status: a.status,
      lastHeartbeatAt: a.lastHeartbeatAt,
    })),
    licenseValid: data.license?.valid ?? false,
  };
}

/**
 * Raw order-request rows as stored by the legacy gateway order-request queue
 * (real lifecycle: queued → executing → filled / partially_filled / rejected /
 * failed). READ ONLY — the Execution Bridge renders the history that queue
 * already holds; it never writes to it. New executions go through
 * `@/api/unified-trading` (`POST /api/trading/execute`).
 */
export interface OrderRequestRow {
  clientOrderId: string;
  accountId?: string;
  symbol?: string;
  action?: string;
  volume?: number;
  price?: number | null;
  sl?: number | null;
  tp?: number | null;
  status?: string;
  errorMessage?: string | null;
  errorCode?: number | null;
  mt5Ticket?: string | null;
  executionPrice?: number | null;
  createdAt?: number;
  executedAt?: number | null;
  updatedAt?: number | null;
}

export async function getOHLCData(
  symbol: string,
  timeframe: string,
  limit = 200
): Promise<{
  candles: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  quote: { bid: number; ask: number };
}> {
  const data = await apiGet<{
    success: boolean;
    candles: unknown[];
    quote: { bid: number; ask: number };
  }>(`/api/analytics/ohlc?symbol=${symbol}&timeframe=${timeframe}&limit=${limit}`);
  return { candles: data.candles as never[], quote: data.quote };
}

export async function analyzeChart(
  symbol: string,
  timeframe: string,
  context?: Record<string, unknown>
): Promise<ChartAnalysis> {
  const period = mapTimeframeToPeriod(timeframe);
  const data = await apiPost<{
    success: boolean;
    analysis: ChartAnalysis;
  }>("/api/strategy-lab/analyze", {
    symbol,
    period,
    ...context,
  });
  return data.analysis;
}

export async function analyzeChartScreenshot(
  screenshotBase64: string,
  context?: Record<string, unknown>
): Promise<string> {
  const symbol = context?.symbol || "XAUUSD";
  const tf = context?.timeframe as string || "H1";
  const period = mapTimeframeToPeriod(tf);
  const exchange = context?.exchange as string || "";
  const price = context?.price as number | undefined;
  const data = await apiPost<{ success: boolean; content: string }>("/api/strategy-lab/analyze", {
    symbol,
    period,
    ...(exchange ? { exchange } : {}),
    ...(price != null ? { price } : {}),
  });
  const rawSummary = (data as Record<string, unknown>).aiSummary;
  const summary: string = typeof rawSummary === "string" ? rawSummary : "Analysis unavailable. Please try again.";
  return summary;
}

function mapTimeframeToPeriod(timeframe: string): string {
  const upper = timeframe.toUpperCase().replace(" ", "");
  if (["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1"].includes(upper)) {
    return "1M";
  }
  return "1M";
}

export interface ChatWithAIResult {
  content: string;
  finishReason?: string;
  truncated?: boolean;
  provider?: string;
  model?: string;
  contextReceived?: boolean;
}

export async function chatWithAI(
  messages: ChatMessage[],
  systemPrompt?: string,
  maxTokens?: number,
  context?: unknown,
  model?: string | null,
): Promise<ChatWithAIResult> {
  console.log(`${EXT_PREFIX} Copilot request`, messages);
  const data = await apiPost<{
    success: boolean;
    content: string;
    finishReason?: string;
    truncated?: boolean;
    provider?: string;
    model?: string;
    contextReceived?: boolean;
  }>("/api/ai/chat", {
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    systemPrompt: systemPrompt || "You are AlgoVault AI, an expert trading assistant. Provide thorough, detailed analysis based on the provided market context. Never fabricate prices or levels. Explain actual chart evidence with full detail.",
    ...(maxTokens != null ? { maxTokens } : {}),
    ...(context !== undefined ? { context } : {}),
    ...(model ? { model } : {}),
  });
  return {
    content: data.content,
    finishReason: data.finishReason,
    truncated: data.truncated,
    provider: data.provider,
    model: data.model,
    contextReceived: data.contextReceived,
  };
}

export async function getAISignals(
  symbol?: string,
  limit = 20
): Promise<AISignal[]> {
  const params = new URLSearchParams();
  if (symbol) params.set("symbol", symbol);
  params.set("limit", String(limit));
  const data = await apiGet<{ success: boolean; signals: AISignal[] }>(
    `/api/ai-signals?${params}`
  );
  return data.signals || [];
}

/* ── extension free daily signals (server-enforced quota) ───────────── */

export interface ExtensionQuota {
  used: number;
  limit: number;
  remaining: number;
  day: string;
  mode: "user" | "install";
}

export interface ExtensionStoredState {
  quota: ExtensionQuota;
  signals: Array<{
    symbol: string;
    direction: string;
    timeframe: string;
    entry: number;
    stopLoss: number;
    stopLossReachedAt?: number;
    takeProfit1: number;
    takeProfit2: number;
    takeProfit3: number;
    confidence: number;
    setup: string;
    reasoning: string;
    createdAt: number;
    riskReward?: number;
    chartEvidence?: string[];
    chartLevels?: Array<{ kind: string; label: string; price: number }>;
  }>;
  symbols: string[];
}

export async function getExtensionDailySignalsState(): Promise<ExtensionStoredState | null> {
  const base = await getBaseUrl();
  const token = await getAuthToken();
  let installId: string | null = null;
  if (!token) {
    installId = await getServerInstallId();
    if (!installId) return null; // no binding yet — local-only fallback
  }
  const params = new URLSearchParams();
  if (installId) params.set("installId", installId);
  const res = await fetch(`${base}/api/extension/daily-signals?${params}`, {
    headers: await authHeaders(),
    method: "GET",
  });
  if (!res.ok) return null; // caller falls back to local quota
  const data = (await res.json()) as {
    success: boolean;
    used: number;
    limit: number;
    remaining: number;
    day: string;
    mode: "user" | "install";
    signals?: ExtensionStoredState["signals"];
    symbols?: string[];
  };
  if (!data.success) return null;
  return {
    quota: { used: data.used, limit: data.limit, remaining: data.remaining, day: data.day, mode: data.mode },
    signals: Array.isArray(data.signals) ? data.signals : [],
    symbols: Array.isArray(data.symbols) ? data.symbols.map((s) => String(s).toUpperCase()) : [],
  };
}

export interface ExtensionGenerateResponse {
  success: boolean;
  signals: ExtensionStoredState["signals"];
  generated: number;
  remaining?: number;
  note?: string;
}

export async function generateSignalsOnServer(
  symbols: string[],
  context: string
): Promise<ExtensionGenerateResponse> {
  const base = await getBaseUrl();
  const token = await getAuthToken();
  const body: Record<string, unknown> = { symbols };
  if (!token) {
    const installId = await getServerInstallId();
    if (installId) body.installId = installId;
  }
  if (context) body.context = context;
  return apiPost<ExtensionGenerateResponse>("/api/extension/daily-signals", body);
}

export async function executeAISignal(
  signalId: string,
  accountId?: string,
  lotSize?: number
): Promise<{ commandId: string; status: string }> {
  const body: Record<string, unknown> = {};
  if (accountId) body.accountId = accountId;
  if (lotSize) body.lotSize = lotSize;
  const data = await apiPost<{
    success: boolean;
    commandId: string;
    status: string;
  }>(`/api/ai-signals/${signalId}/execute`, body);
  return { commandId: data.commandId, status: data.status };
}

export async function createSignal(signal: Partial<Signal>): Promise<Signal> {
  const data = await apiPost<{ success: boolean; signal: Signal }>(
    "/api/ai-signals",
    signal as Record<string, unknown>
  );
  return data.signal;
}

export async function getRiskAnalysis(
  accountId: string
): Promise<{
  accountBalance: number;
  accountEquity: number;
  marginUsed: number;
  marginFree: number;
  floatingPnl: number;
  drawdown: number;
  totalRiskExposure: number;
  marginUtilization: number;
  totalPositions: number;
}> {
  const data = await apiGet<{
    success: boolean;
    risk: {
      accountBalance: number;
      accountEquity: number;
      marginUsed: number;
      marginFree: number;
      floatingPnl: number;
      drawdown: number;
      totalRiskExposure: number;
      marginUtilization: number;
      totalPositions: number;
    };
  }>(`/api/analytics/risk?accountId=${accountId}`);
  return data.risk;
}

export async function getPositions(
  accountId: string
): Promise<
  Array<{
    ticket: number;
    symbol: string;
    direction: string;
    volume: number;
    openPrice: number;
    currentPrice: number;
    pnl: number;
    openTime: number;
  }>
> {
  const data = await apiGet<{
    success: boolean;
    positions: unknown[];
  }>(`/api/trading/positions?accountId=${accountId}`);
  return data.positions as never[];
}

export async function getStrategies(): Promise<
  Array<{ id: string; name: string; symbol: string; timeframe: string }>
> {
  const data = await apiGet<{
    success: boolean;
    strategies: Array<{ id: string; name: string; symbol: string; timeframe: string }>;
  }>("/api/strategy-lab/strategies");
  return data.strategies || [];
}

export async function runBacktest(params: {
  symbol: string;
  strategyId?: string;
  strategy?: Record<string, unknown>;
  config?: Record<string, unknown>;
  from?: string;
  to?: string;
}): Promise<{
  metrics: Record<string, number>;
  equity: Array<{ time: number; value: number }>;
}> {
  const data = await apiPost<{
    success: boolean;
    backtest: { metrics: Record<string, number>; equity: Array<{ time: number; value: number }> };
  }>("/api/strategy-lab/backtest", params as Record<string, unknown>);
  return data.backtest;
}

export async function runOptimize(params: {
  symbol: string;
  strategyId?: string;
  strategy?: Record<string, unknown>;
  timeframe?: string;
  config?: Record<string, unknown>;
}): Promise<{
  optimization: Record<string, unknown>;
  savedId?: string;
}> {
  const data = await apiPost<{
    success: boolean;
    optimization: Record<string, unknown>;
    savedId?: string;
  }>("/api/strategy-lab/optimize", params as Record<string, unknown>);
  return data;
}

export async function openStrategyLab(
  symbol: string,
  timeframe: string,
  context?: Record<string, unknown>
): Promise<void> {
  const params = new URLSearchParams();
  params.set("symbol", symbol);
  if (timeframe) params.set("timeframe", timeframe);
  if (context) params.set("context", JSON.stringify(context));
  const base = await getBaseUrl();
  window.open(`${base}/strategy-lab?${params.toString()}`, "_blank");
}

export async function runBacktestFromExtension(
  symbol: string,
  timeframe: string
): Promise<void> {
  const base = await getBaseUrl();
  const params = new URLSearchParams();
  params.set("symbol", symbol);
  if (timeframe) params.set("timeframe", timeframe);
  window.open(`${base}/backtests?${params.toString()}`, "_blank");
}

export async function getAccountInfo(): Promise<{
  success: boolean;
  health?: Record<string, unknown>;
} | null> {
  try {
    console.log(`${EXT_PREFIX} getAccountInfo`);
    const data = await apiGet<{ success: true; health: Record<string, unknown> }>("/api/account-health");
    return data;
  } catch {
    return null;
  }
}
