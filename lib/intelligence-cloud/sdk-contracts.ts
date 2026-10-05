/**
 * Intelligence Cloud — SDK Contracts (Phase 9)
 *
 * Conceptual contracts for JavaScript/TypeScript and Python SDKs.
 * The SDK must call the public Intelligence Cloud API — never duplicate
 * intelligence logic locally.
 */

import type { IntelligenceRequest, IntelligenceResponse } from "./contracts";

export interface SDKConfig {
  apiKey?: string;
  baseUrl?: string;
  version?: string;
  timeoutMs?: number;
}

export interface SDKClient {
  market: {
    intelligence(req: IntelligenceRequest): Promise<IntelligenceResponse>;
  };
  strategy: {
    validate(req: { definition: unknown; symbol?: string; timeframe?: string }): Promise<{ valid: boolean; issues: unknown[]; engineVersions: Record<string, string> }>;
  };
  research: {
    submit(req: { type: string; symbol: string; timeframe: string; config?: unknown }): Promise<{ jobId: string; status: string }>;
  };
}

/**
 * Conceptual SDK usage (not a live package):
 *
 * const algovault = createSDK({ apiKey: "av_key_..." });
 * const result = await algovault.market.intelligence({
 *   symbol: "XAUUSD",
 *   timeframe: "M5"
 * });
 */

export function describeSDKUsage(): string {
  return `
import { createSDK } from "@algovault/intelligence-sdk";

const client = createSDK({ apiKey: process.env.AV_API_KEY, baseUrl: "https://api.algovault.io/intelligence/v2" });

const market = await client.market.intelligence({
  symbol: "XAUUSD",
  timeframe: "5m",
  context: { smartMoney: true, indicators: ["rsi", "macd"] }
});

console.log(market.smartMoney, market.indicators, market.engineVersions);
  `.trim();
}
