import { getAuthToken, getSettings } from "@/storage/storage";
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
    console.log(`${EXT_PREFIX} checkHealth -> ${base}/api/account-health`);
    const res = await fetch(`${base}/api/account-health`, { method: "GET" });
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
      accountNumber: string;
      broker: string;
      server: string;
      balance: number;
      equity: number;
      currency: string;
    }>;
    license: { valid: boolean };
  }>("/api/trading/gateway/status");
  return {
    connected: data.accounts?.length > 0,
    accounts: data.accounts || [],
    licenseValid: data.license?.valid ?? false,
  };
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

export async function placeOrder(order: {
  accountId: string;
  symbol: string;
  action: string;
  volume: number;
  price?: number;
  sl?: number;
  tp?: number;
  clientOrderId?: string;
}): Promise<{ success: boolean; order: { clientOrderId: string; status: string } }> {
  return apiPost("/api/trading/orders", order as Record<string, unknown>);
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
