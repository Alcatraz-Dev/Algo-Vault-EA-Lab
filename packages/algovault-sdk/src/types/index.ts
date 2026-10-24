/**
 * AlgoVault SDK Types
 * Based on Intelligence Cloud API contracts
 */

export interface AlgoVaultConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  fetch?: typeof fetch;
}

export interface ApiErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
}

export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  reset?: number;
}

export interface MarketDataParams {
  symbol: string;
  timeframe?: string;
}

export interface MarketResponse {
  apiVersion?: string;
  instrument?: {
    symbol: string;
    timeframe: string;
    exchange?: string;
    dataSource?: string;
  };
  marketState?: any;
  regime?: any;
  limitations?: string[];
  engineVersions?: any;
  dataTimestamp?: number;
  availableAt?: number;
  dataLineage?: any[];
  cost?: any;
  [key: string]: unknown;
}

export interface GraphParams {
  symbol: string;
}

export interface RelationshipsParams {
  symbol: string;
}

export interface IndicatorsParams {
  symbol: string;
  timeframe?: string;
}

export interface AnalyticsParams {
  symbol?: string;
}

export interface SmartMoneyParams {
  symbol: string;
}

export interface StrategyValidateRequest {
  symbol: string;
  timeframe?: string;
  rules?: unknown;
  [key: string]: unknown;
}

export interface ResearchListResponse {
  jobs?: any[];
  [key: string]: unknown;
}

export interface ResearchCreateRequest {
  symbol?: string;
  timeframe?: string;
  objective?: string;
  [key: string]: unknown;
}

export interface ResearchJobResponse {
  jobId?: string;
  status?: string;
  [key: string]: unknown;
}

export interface AccountsResponse {
  accounts?: any[];
  [key: string]: unknown;
}

export interface PositionsResponse {
  positions?: any[];
  [key: string]: unknown;
}

export type AllParams = 
  | MarketDataParams 
  | GraphParams 
  | RelationshipsParams 
  | IndicatorsParams 
  | AnalyticsParams 
  | SmartMoneyParams;
