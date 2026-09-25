import { ApiResponse, PaginatedResponse, MarketQuote, AISignal, UserBot, TradingAccount, UserProfile, UserLicense, Alert, Notification, Subscription, RiskMetrics } from "./types";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";

class ApiClient {
  private baseUrl: string;
  private authToken: string | null = null;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  setAuthToken(token: string | null) {
    this.authToken = token;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    if (this.authToken) {
      (headers as Record<string, string>)["Authorization"] = `Bearer ${this.authToken}`;
    }

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error || `HTTP ${response.status}`,
        };
      }

      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Network error",
      };
    }
  }

  // Market data
  async getQuotes(symbols?: string[]): Promise<ApiResponse<MarketQuote[]>> {
    const params = symbols ? `?symbols=${symbols.join(",")}` : "";
    return this.request<MarketQuote[]>(`/api/signals/quotes${params}`);
  }

  async getSymbols(): Promise<ApiResponse<string[]>> {
    return this.request<string[]>("/api/signals/symbols");
  }

  // AI Signals
  async getSignals(params?: {
    tier?: "FREE" | "PRO";
    status?: "active" | "closed";
    symbol?: string;
    limit?: number;
  }): Promise<ApiResponse<AISignal[]>> {
    const searchParams = new URLSearchParams();
    if (params?.tier) searchParams.set("tier", params.tier);
    if (params?.status) searchParams.set("status", params.status);
    if (params?.symbol) searchParams.set("symbol", params.symbol);
    if (params?.limit) searchParams.set("limit", params.limit.toString());

    return this.request<AISignal[]>(`/api/signals?${searchParams.toString()}`);
  }

  async getSignal(id: string): Promise<ApiResponse<AISignal>> {
    return this.request<AISignal>(`/api/signals/${id}`);
  }

  // Bots
  async getBots(): Promise<ApiResponse<UserBot[]>> {
    return this.request<UserBot[]>("/api/bots");
  }

  async getBot(id: string): Promise<ApiResponse<UserBot>> {
    return this.request<UserBot>(`/api/bots/${id}`);
  }

  async startBot(id: string): Promise<ApiResponse<{ success: boolean }>> {
    return this.request<{ success: boolean }>(`/api/bots/${id}/start`, {
      method: "POST",
    });
  }

  async stopBot(id: string): Promise<ApiResponse<{ success: boolean }>> {
    return this.request<{ success: boolean }>(`/api/bots/${id}/stop`, {
      method: "POST",
    });
  }

  // Trading Accounts
  async getAccounts(): Promise<ApiResponse<TradingAccount[]>> {
    return this.request<TradingAccount[]>("/api/account/trading-accounts");
  }

  async getAccount(id: string): Promise<ApiResponse<TradingAccount>> {
    return this.request<TradingAccount>(`/api/account/trading-accounts/${id}`);
  }

  // User Profile
  async getProfile(): Promise<ApiResponse<UserProfile>> {
    return this.request<UserProfile>("/api/user/profile");
  }

  async updateProfile(data: Partial<UserProfile>): Promise<ApiResponse<UserProfile>> {
    return this.request<UserProfile>("/api/user/profile", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  // Licenses
  async getLicenses(): Promise<ApiResponse<UserLicense[]>> {
    return this.request<UserLicense[]>("/api/account/licenses");
  }

  // Alerts
  async getAlerts(params?: { unreadOnly?: boolean; limit?: number }): Promise<ApiResponse<Alert[]>> {
    const searchParams = new URLSearchParams();
    if (params?.unreadOnly) searchParams.set("unreadOnly", "true");
    if (params?.limit) searchParams.set("limit", params.limit.toString());

    return this.request<Alert[]>(`/api/alerts?${searchParams.toString()}`);
  }

  async markAlertRead(id: string): Promise<ApiResponse<{ success: boolean }>> {
    return this.request<{ success: boolean }>(`/api/alerts/${id}/read`, {
      method: "POST",
    });
  }

  // Notifications
  async getNotifications(params?: { unreadOnly?: boolean; limit?: number }): Promise<ApiResponse<Notification[]>> {
    const searchParams = new URLSearchParams();
    if (params?.unreadOnly) searchParams.set("unreadOnly", "true");
    if (params?.limit) searchParams.set("limit", params.limit.toString());

    return this.request<Notification[]>(`/api/notifications?${searchParams.toString()}`);
  }

  async markNotificationRead(id: string): Promise<ApiResponse<{ success: boolean }>> {
    return this.request<{ success: boolean }>(`/api/notifications/${id}/read`, {
      method: "POST",
    });
  }

  // Subscriptions
  async getSubscription(): Promise<ApiResponse<Subscription>> {
    return this.request<Subscription>("/api/account/subscription");
  }

  // Risk Metrics
  async getRiskMetrics(accountId: string): Promise<ApiResponse<RiskMetrics>> {
    return this.request<RiskMetrics>(`/api/risk/metrics/${accountId}`);
  }

  // Mobile aggregated endpoint
  async getMobileDashboard(): Promise<ApiResponse<{
    accounts: TradingAccount[];
    bots: UserBot[];
    signals: AISignal[];
    alerts: Alert[];
    riskMetrics: RiskMetrics[];
  }>> {
    return this.request("/api/mobile/dashboard");
  }
}

export const apiClient = new ApiClient();