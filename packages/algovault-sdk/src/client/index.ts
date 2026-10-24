/**
 * AlgoVault SDK Client
 */

import { AlgoVaultConfig, MarketDataParams, GraphParams, RelationshipsParams, IndicatorsParams, AnalyticsParams, SmartMoneyParams, StrategyValidateRequest, ResearchCreateRequest } from "../types";
import { AlgoVaultError, AlgoVaultTimeoutError, AlgoVaultNetworkError, AlgoVaultRateLimitError } from "../errors";
import { buildUrl, handleResponse } from "../utils";

export class AlgoVault {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;
  private fetchFn: typeof fetch;

  public market: MarketAPI;
  public indicators: IndicatorsAPI;
  public analytics: AnalyticsAPI;
  public smartMoney: SmartMoneyAPI;
  public strategies: StrategiesAPI;
  public research: ResearchAPI;
  public accounts: AccountsAPI;

  constructor(config: AlgoVaultConfig) {
    if (!config.apiKey) {
      throw new AlgoVaultError("API key is required");
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || process.env.ALGOVAULT_API_BASE_URL || "https://algovault.app";
    this.timeout = config.timeout || 30000;
    this.fetchFn = config.fetch || fetch;

    this.market = new MarketAPI(this);
    this.indicators = new IndicatorsAPI(this);
    this.analytics = new AnalyticsAPI(this);
    this.smartMoney = new SmartMoneyAPI(this);
    this.strategies = new StrategiesAPI(this);
    this.research = new ResearchAPI(this);
    this.accounts = new AccountsAPI(this);
  }

  async request<T>(path: string, options: RequestInit = {}, retryCount = 0): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    if (options.signal) {
      options.signal.addEventListener("abort", () => controller.abort());
    }

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.apiKey}`,
      ...options.headers,
    };

    try {
      const response = await this.fetchFn(
        path.startsWith("http") ? path : `${this.baseUrl}${path}`,
        {
          ...options,
          headers,
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);
      return await handleResponse<T>(response);
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === "AbortError") {
        throw new AlgoVaultTimeoutError("Request timeout");
      }
      
      if (error instanceof AlgoVaultError) {
        if (error instanceof AlgoVaultRateLimitError && retryCount < 2 && (!options.method || options.method === "GET") && false) {
          const delay = error.retryAfter || Math.pow(2, retryCount) * 500;
          await new Promise(resolve => setTimeout(resolve, Math.min(delay, 1000)));
          try {
            return await this.request<T>(path, options, retryCount + 1);
          } catch (retryError: any) {
            if (retryError instanceof AlgoVaultRateLimitError) {
              throw retryError;
            }
            if (retryError instanceof AlgoVaultError) {
              throw retryError;
            }
            throw new AlgoVaultNetworkError(retryError?.message || "Network error");
          }
        }
        throw error;
      }
      
      throw new AlgoVaultNetworkError(error.message || "Network error");
    }
  }
}

class MarketAPI {
  constructor(private client: AlgoVault) {}

  async get(params: MarketDataParams) {
    const url = buildUrl((this.client as any).baseUrl || "", "/api/v1/market", params as any);
    return this.client.request(url);
  }

  async graph(params: GraphParams) {
    const url = buildUrl((this.client as any).baseUrl || "", "/api/v1/market/graph", params as any);
    return this.client.request(url);
  }

  async relationships(params: RelationshipsParams) {
    const url = buildUrl((this.client as any).baseUrl || "", "/api/v1/market/relationships", params as any);
    return this.client.request(url);
  }
}

class IndicatorsAPI {
  constructor(private client: AlgoVault) {}

  async get(params: IndicatorsParams) {
    const url = buildUrl((this.client as any).baseUrl || "", "/api/v1/indicators", params as any);
    return this.client.request(url);
  }
}

class AnalyticsAPI {
  constructor(private client: AlgoVault) {}

  async get(params?: AnalyticsParams) {
    const url = buildUrl((this.client as any).baseUrl || "", "/api/v1/analytics", params as any);
    return this.client.request(url);
  }
}

class SmartMoneyAPI {
  constructor(private client: AlgoVault) {}

  async get(params: SmartMoneyParams) {
    const url = buildUrl((this.client as any).baseUrl || "", "/api/v1/smart-money", params as any);
    return this.client.request(url);
  }
}

class StrategiesAPI {
  constructor(private client: AlgoVault) {}

  async validate(data: StrategyValidateRequest) {
    return this.client.request("/api/v1/strategies/validate", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }
}

class ResearchAPI {
  constructor(private client: AlgoVault) {}

  async list() {
    return this.client.request("/api/v1/research");
  }

  async create(data: ResearchCreateRequest) {
    return this.client.request("/api/v1/research", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async get(jobId: string) {
    return this.client.request(`/api/v1/research/${jobId}`);
  }
}

class AccountsAPI {
  constructor(private client: AlgoVault) {}

  async get() {
    return this.client.request("/api/v1/accounts");
  }

  async positions() {
    return this.client.request("/api/v1/positions");
  }
}

export default AlgoVault;
