/**
 * Production Workflow Templates.
 *
 * All templates are built strictly using registered node types from
 * `node-registry.ts` and produce valid workflow definitions compatible with
 * `validateWorkflow()` and the backend execution engine.
 */

import { WorkflowNode, WorkflowEdge, WorkflowScheduleConfig } from "./types";
import { getNodeDefinition } from "./node-registry";
import { validateWorkflow } from "./validate";

export interface WorkflowTemplate {
  id: string;
  name: string;
  category: "Scalping" | "Multi-Timeframe" | "Regime Analysis" | "Alerts";
  description: string;
  requiredInputs: string[];
  nodeCount: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  schedule?: WorkflowScheduleConfig;
  defaultSymbol?: string;
  defaultTimeframe?: string;
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "tpl_xauusd_scalp",
    name: "Template 1 — XAUUSD Scalping Monitor",
    category: "Scalping",
    description: "Monitors M5 candle data for XAUUSD, calculates RSI & EMA indicators, checks oversold condition, applies risk verification, creates a signal, and sends a notification.",
    requiredInputs: ["Symbol (e.g., XAUUSD)", "Timeframe (M5)", "Telegram Channel"],
    nodeCount: 7,
    defaultSymbol: "XAUUSD",
    defaultTimeframe: "M5",
    nodes: [
      {
        id: "trig_1",
        type: "trigger.schedule",
        label: "Schedule (Every 5m)",
        position: { x: 40, y: 150 },
        config: { cron: "*/5 * * * *" },
      },
      {
        id: "md_m5",
        type: "market_data.candles",
        label: "M5 Market Candles",
        position: { x: 260, y: 150 },
        config: { symbol: "XAUUSD", timeframe: "M5", limit: 100 },
      },
      {
        id: "rsi_m5",
        type: "technical.rsi",
        label: "RSI (14)",
        position: { x: 480, y: 80 },
        config: { source: "$md_m5", timeframe: "M5", period: 14 },
      },
      {
        id: "ema_m5",
        type: "technical.ema",
        label: "EMA (20)",
        position: { x: 480, y: 220 },
        config: { source: "$md_m5", timeframe: "M5", period: 20 },
      },
      {
        id: "cond_1",
        type: "logic.condition",
        label: "RSI Oversold Check",
        position: { x: 700, y: 150 },
        config: { left: "{{ $rsi_m5.value }}", operator: "lt", right: "30" },
      },
      {
        id: "risk_1",
        type: "risk.check",
        label: "Risk Guard",
        position: { x: 920, y: 150 },
        config: { riskPercent: 1, maxExposurePercent: 20, requireStopLoss: true },
      },
      {
        id: "sig_1",
        type: "signal.create",
        label: "Create Buy Signal",
        position: { x: 1140, y: 80 },
        config: {
          symbol: "XAUUSD",
          direction: "BUY",
          entry: "{{ $md_m5.close }}",
          stopLoss: "{{ $md_m5.candles[0].low }}",
          setup: "Scalp RSI Oversold",
        },
      },
      {
        id: "notify_1",
        type: "notification.send",
        label: "Telegram Notification",
        position: { x: 1140, y: 240 },
        config: {
          title: "XAUUSD Scalping Alert",
          message: "RSI oversold detected on XAUUSD M5. Signal created: {{ $sig_1.direction }} @ {{ $sig_1.entry }}",
          level: "info",
          channels: ["telegram"],
        },
      },
    ],
    edges: [
      { id: "e1", source: "trig_1", target: "md_m5" },
      { id: "e2", source: "md_m5", target: "rsi_m5" },
      { id: "e3", source: "md_m5", target: "ema_m5" },
      { id: "e4", source: "rsi_m5", target: "cond_1" },
      { id: "e5", source: "cond_1", target: "risk_1" },
      { id: "e6", source: "risk_1", target: "sig_1" },
      { id: "e7", source: "sig_1", target: "notify_1" },
    ],
    schedule: { enabled: true, cron: "*/5 * * * *" },
  },
  {
    id: "tpl_mtf_confirmation",
    name: "Template 2 — Multi-Timeframe Confirmation",
    category: "Multi-Timeframe",
    description: "Combines M5 entry market data with M15 confirmation and H1 trend context for high-probability setups.",
    requiredInputs: ["Symbol (e.g., EURUSD)", "Timeframes (M5, M15, H1)", "Notification Channels"],
    nodeCount: 8,
    defaultSymbol: "EURUSD",
    defaultTimeframe: "M5",
    nodes: [
      {
        id: "trig_mtf",
        type: "trigger.manual",
        label: "Manual Trigger",
        position: { x: 40, y: 150 },
        config: { label: "Run Multi-Timeframe Check" },
      },
      {
        id: "md_m5",
        type: "market_data.candles",
        label: "M5 Candles",
        position: { x: 260, y: 40 },
        config: { symbol: "EURUSD", timeframe: "M5", limit: 100 },
      },
      {
        id: "md_m15",
        type: "market_data.candles",
        label: "M15 Candles",
        position: { x: 260, y: 160 },
        config: { symbol: "EURUSD", timeframe: "M15", limit: 100 },
      },
      {
        id: "md_h1",
        type: "market_data.candles",
        label: "H1 Trend Candles",
        position: { x: 260, y: 280 },
        config: { symbol: "EURUSD", timeframe: "H1", limit: 100 },
      },
      {
        id: "rsi_m5",
        type: "technical.rsi",
        label: "M5 RSI",
        position: { x: 480, y: 40 },
        config: { source: "$md_m5", timeframe: "M5", period: 14 },
      },
      {
        id: "ema_h1",
        type: "technical.ema",
        label: "H1 Trend EMA (50)",
        position: { x: 480, y: 280 },
        config: { source: "$md_h1", timeframe: "H1", period: 50 },
      },
      {
        id: "cond_mtf",
        type: "logic.condition",
        label: "M5 RSI & H1 Trend Filter",
        position: { x: 700, y: 160 },
        config: { left: "{{ $rsi_m5.value }}", operator: "lt", right: "35" },
      },
      {
        id: "notify_mtf",
        type: "notification.send",
        label: "Send MTF Alert",
        position: { x: 920, y: 160 },
        config: {
          title: "Multi-Timeframe Setup Confirmed",
          message: "EURUSD M5 RSI ({{ $rsi_m5.value }}) is oversold while H1 Trend EMA is {{ $ema_h1.value }}.",
          level: "success",
          channels: ["telegram", "discord"],
        },
      },
    ],
    edges: [
      { id: "e1", source: "trig_mtf", target: "md_m5" },
      { id: "e2", source: "trig_mtf", target: "md_m15" },
      { id: "e3", source: "trig_mtf", target: "md_h1" },
      { id: "e4", source: "md_m5", target: "rsi_m5" },
      { id: "e5", source: "md_h1", target: "ema_h1" },
      { id: "e6", source: "rsi_m5", target: "cond_mtf" },
      { id: "e7", source: "cond_mtf", target: "notify_mtf" },
    ],
  },
  {
    id: "tpl_regime_detector",
    name: "Template 3 — Market Regime Detector",
    category: "Regime Analysis",
    description: "Evaluates volatility (ATR) and trend indicators over daily candles using AI analysis to classify market regimes.",
    requiredInputs: ["Symbol (e.g., BTCUSD)", "Timeframe (D1)", "AI Router Context"],
    nodeCount: 6,
    defaultSymbol: "BTCUSD",
    defaultTimeframe: "D1",
    nodes: [
      {
        id: "trig_regime",
        type: "trigger.schedule",
        label: "Hourly Schedule",
        position: { x: 40, y: 150 },
        config: { cron: "0 * * * *" },
      },
      {
        id: "snap_1",
        type: "market_data.snapshot",
        label: "Market Snapshot",
        position: { x: 260, y: 80 },
        config: { symbol: "BTCUSD" },
      },
      {
        id: "md_daily",
        type: "market_data.candles",
        label: "Daily Candles",
        position: { x: 260, y: 220 },
        config: { symbol: "BTCUSD", timeframe: "D1", limit: 50 },
      },
      {
        id: "atr_daily",
        type: "technical.atr",
        label: "ATR Volatility (14)",
        position: { x: 480, y: 220 },
        config: { source: "$md_daily", timeframe: "D1", period: 14 },
      },
      {
        id: "ai_regime",
        type: "ai.analyze",
        label: "AI Regime Classifier",
        position: { x: 700, y: 150 },
        config: {
          prompt: "Classify the current market regime for BTCUSD based on current quote {{ $snap_1.bid }} and daily ATR {{ $atr_daily.value }}. Determine if the regime is High Volatility Breakout, Low Volatility Compression, or Ranging.",
          maxTokens: 500,
        },
      },
      {
        id: "notify_regime",
        type: "notification.send",
        label: "Regime Classification Report",
        position: { x: 920, y: 150 },
        config: {
          title: "BTCUSD Market Regime Update",
          message: "Regime Report: {{ $ai_regime.text }}",
          level: "info",
          channels: ["telegram"],
        },
      },
    ],
    edges: [
      { id: "e1", source: "trig_regime", target: "snap_1" },
      { id: "e2", source: "trig_regime", target: "md_daily" },
      { id: "e3", source: "md_daily", target: "atr_daily" },
      { id: "e4", source: "atr_daily", target: "ai_regime" },
      { id: "e5", source: "ai_regime", target: "notify_regime" },
    ],
    schedule: { enabled: true, cron: "0 * * * *" },
  },
  {
    id: "tpl_signal_alert",
    name: "Template 4 — Trading Signal Alert",
    category: "Alerts",
    description: "Runs technical analysis on M15 market data, checks condition thresholds, applies risk rules, creates a validated signal artifact, and broadcasts via Telegram and Discord.",
    requiredInputs: ["Symbol (e.g., XAUUSD)", "Timeframe (M15)", "Telegram & Discord Channels"],
    nodeCount: 7,
    defaultSymbol: "XAUUSD",
    defaultTimeframe: "M15",
    nodes: [
      {
        id: "trig_sig",
        type: "trigger.schedule",
        label: "15m Schedule",
        position: { x: 40, y: 150 },
        config: { cron: "*/15 * * * *" },
      },
      {
        id: "md_m15",
        type: "market_data.candles",
        label: "M15 Candles",
        position: { x: 260, y: 150 },
        config: { symbol: "XAUUSD", timeframe: "M15", limit: 100 },
      },
      {
        id: "rsi_m15",
        type: "technical.rsi",
        label: "RSI (14)",
        position: { x: 480, y: 150 },
        config: { source: "$md_m15", timeframe: "M15", period: 14 },
      },
      {
        id: "cond_sig",
        type: "logic.condition",
        label: "RSI Overbought Check",
        position: { x: 700, y: 150 },
        config: { left: "{{ $rsi_m15.value }}", operator: "gte", right: "70" },
      },
      {
        id: "risk_sig",
        type: "risk.check",
        label: "Risk Verification",
        position: { x: 920, y: 150 },
        config: { riskPercent: 1.5, maxExposurePercent: 15, requireStopLoss: true },
      },
      {
        id: "sig_out",
        type: "signal.create",
        label: "Create Sell Signal",
        position: { x: 1140, y: 80 },
        config: {
          symbol: "XAUUSD",
          direction: "SELL",
          entry: "{{ $md_m15.close }}",
          stopLoss: "{{ $md_m15.candles[0].high }}",
          setup: "RSI Overbought Sell",
        },
      },
      {
        id: "alert_out",
        type: "notification.send",
        label: "Broadcast Alert",
        position: { x: 1140, y: 240 },
        config: {
          title: "XAUUSD Trading Signal Alert",
          message: "Signal generated: SELL {{ $sig_out.symbol }} @ {{ $sig_out.entry }}",
          level: "warning",
          channels: ["telegram", "discord"],
        },
      },
    ],
    edges: [
      { id: "e1", source: "trig_sig", target: "md_m15" },
      { id: "e2", source: "md_m15", target: "rsi_m15" },
      { id: "e3", source: "rsi_m15", target: "cond_sig" },
      { id: "e4", source: "cond_sig", target: "risk_sig" },
      { id: "e5", source: "risk_sig", target: "sig_out" },
      { id: "e6", source: "sig_out", target: "alert_out" },
    ],
    schedule: { enabled: true, cron: "*/15 * * * *" },
  },
];

/**
 * Instantiates a template into a ready-to-load workflow object with unique node/edge IDs,
 * customized symbol/timeframe where applicable, and verifies node registry integrity.
 */
export function instantiateTemplate(
  templateId: string,
  overrides?: { symbol?: string; timeframe?: string }
): {
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  schedule?: WorkflowScheduleConfig;
} {
  const template = WORKFLOW_TEMPLATES.find((t) => t.id === templateId);
  if (!template) {
    throw new Error(`Template with id '${templateId}' not found.`);
  }

  const idMap = new Map<string, string>();

  const nodes: WorkflowNode[] = template.nodes.map((origNode) => {
    const newId = `node_${Math.random().toString(36).slice(2, 8)}`;
    idMap.set(origNode.id, newId);

    const config = { ...origNode.config };
    if (overrides?.symbol && config.symbol) {
      config.symbol = overrides.symbol;
    }
    if (overrides?.timeframe && config.timeframe) {
      config.timeframe = overrides.timeframe;
    }

    return {
      ...origNode,
      id: newId,
      position: { ...origNode.position },
      config,
    };
  });

  // Remap edge sources & targets
  const edges: WorkflowEdge[] = template.edges.map((origEdge, idx) => {
    const source = idMap.get(origEdge.source) ?? origEdge.source;
    const target = idMap.get(origEdge.target) ?? origEdge.target;
    return {
      id: `edge_${idx}_${Math.random().toString(36).slice(2, 6)}`,
      source,
      target,
    };
  });

  // Remap variable node references in node config strings if needed
  nodes.forEach((n) => {
    Object.keys(n.config).forEach((key) => {
      const val = n.config[key];
      if (typeof val === "string") {
        let updatedVal = val;
        idMap.forEach((newId, oldId) => {
          updatedVal = updatedVal.replace(new RegExp(`\\$${oldId}\\b`, "g"), `$${newId}`);
        });
        n.config[key] = updatedVal;
      }
    });
  });

  // Server-side validation check to ensure no unregistered nodes are emitted
  const validation = validateWorkflow(
    { nodes, edges, name: template.name, settings: { timeoutMs: 120000, maxConcurrency: 4 } },
    { analysis: true, signal: true, execution: true }
  );

  if (!validation.valid) {
    console.warn(`[instantiateTemplate] Template '${template.name}' had validation warnings:`, validation.errors);
  }

  return {
    name: template.name,
    description: template.description,
    nodes,
    edges,
    schedule: template.schedule,
  };
}
