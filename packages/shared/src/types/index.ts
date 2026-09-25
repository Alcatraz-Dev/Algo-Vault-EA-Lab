export interface TradingAccount {
  id: string;
  mt5Account: string;
  broker: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  status: string;
  lastHeartbeatAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface UserBot {
  id: string;
  ownerId: string;
  type: "marketplace" | "custom";
  name: string;
  description?: string;
  symbol: string;
  timeframe: string;
  status: "running" | "stopped" | "error" | "pending";
  pnl: number;
  dailyPnl: number;
  drawdown: number;
  maxDrawdown: number;
  totalTrades: number;
  winRate: number;
  licenseExpiresAt?: number;
  licenseTier?: "free" | "pro" | "enterprise";
  marketplaceItemId?: string;
  createdAt: number;
  updatedAt: number;
  lastHeartbeatAt?: number;
}

export interface AISignal {
  id: string;
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  riskReward: number;
  timeframe: string;
  status: "active" | "closed" | "cancelled";
  tier: "FREE" | "PRO";
  strength: "WEAK" | "MODERATE" | "STRONG";
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  closedPrice?: number;
  pnl?: number;
}

export interface MarketQuote {
  symbol: string;
  bid: number;
  ask: number;
  change?: number;
  changePercent?: number;
  high?: number;
  low?: number;
  timestamp: number;
}

export interface UserProfile {
  uid?: string;
  email?: string;
  displayName?: string;
  photoURL?: string;
  tier?: "free" | "pro" | "enterprise";
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionStatus?: "active" | "canceled" | "past_due" | "trialing";
  subscriptionTier?: "free" | "pro" | "enterprise";
  createdAt?: number;
  updatedAt?: number;
}

export interface UserLicense {
  id: string;
  userId: string;
  productId: string;
  productName: string;
  tier: "free" | "pro" | "enterprise";
  status: "active" | "expired" | "revoked" | "pending";
  expiresAt?: number;
  activatedAt: number;
  createdAt: number;
}

export interface Alert {
  id: string;
  userId: string;
  type: "price" | "signal" | "bot" | "risk" | "system";
  title: string;
  message: string;
  severity: "info" | "warning" | "critical";
  read: boolean;
  createdAt: number;
  data?: Record<string, unknown>;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  read: boolean;
  createdAt: number;
}

export interface Subscription {
  id: string;
  userId: string;
  stripeSubscriptionId: string;
  status: "active" | "canceled" | "past_due" | "trialing";
  tier: "free" | "pro" | "enterprise";
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  createdAt: number;
}

export interface BotMarketplaceItem {
  id: string;
  name: string;
  description: string;
  author: string;
  price: number;
  currency: string;
  tier: "free" | "pro" | "enterprise";
  category: string;
  tags: string[];
  rating: number;
  reviewCount: number;
  downloadCount: number;
  symbol: string;
  timeframe: string;
  minBalance: number;
  maxDrawdown: number;
  screenshots: string[];
  createdAt: number;
  updatedAt: number;
}

export interface RiskMetrics {
  accountId: string;
  equity: number;
  balance: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  dailyPnl: number;
  dailyPnlPercent: number;
  maxDrawdown: number;
  currentDrawdown: number;
  openPositions: number;
  riskScore: number;
  riskStatus: "normal" | "attention" | "critical";
  lastUpdated: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export type DeepLinkRoute =
  | "/mobile/home"
  | "/mobile/markets"
  | "/mobile/signals"
  | "/mobile/bots"
  | "/mobile/account"
  | `/mobile/markets/${string}`
  | `/mobile/signals/${string}`
  | `/mobile/bots/${string}`
  | `/mobile/account/${string}`;