import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  Brain,
  Calculator,
  CandlestickChart,
  Copy,
  CreditCard,
  FileCode2,
  FileKey2,
  FileText,
  FlaskConical,
  Gauge,
  GitBranch,
  History,
  LineChart,
  LayoutDashboard,
  Layers,
  MonitorPlay,
  Newspaper,
  Radio,
  Receipt,
  Repeat,
  Rocket,
  ScrollText,
  Shield,
  Sparkles,
  Target,
  Terminal,
  TrendingUp,
  UserRound,
  Wallet,
  Zap,
} from "lucide-react";
import type { NavGroup } from "@/components/layout/AppShell";

/**
 * AppNav — canonical sidebar navigation for the authenticated application.
 * Groups are product domains, ordered by the core trading workflow.
 */
export const APP_NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/portfolio", label: "Portfolio", icon: Wallet },
      { href: "/goals", label: "Goals", icon: Target },
    ],
  },
  {
    label: "Markets",
    items: [
      { href: "/scanner", label: "Market Scanner", icon: Activity },
      { href: "/analysis", label: "Market Analysis", icon: BarChart3 },
      { href: "/advanced-analysis", label: "Advanced Analysis", icon: Layers },
      { href: "/charts", label: "Charts", icon: CandlestickChart },
      { href: "/economic-calendar", label: "Economic Calendar", icon: Newspaper },
      { href: "/risk", label: "Risk Analysis", icon: Shield },
    ],
  },
  {
    label: "Trading",
    items: [
      { href: "/trading", label: "Terminal", icon: Terminal },
      { href: "/trade-management", label: "Trade Management", icon: Layers },
      { href: "/execution-analytics", label: "Execution Analytics", icon: Gauge },
      { href: "/trade-journal", label: "Trade Journal", icon: ScrollText },
      { href: "/account-health", label: "Account Health", icon: Activity },
      { href: "/statement", label: "Statement", icon: Receipt },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/ai-copilot", label: "AI Copilot", icon: Brain },
      { href: "/scalping-terminal", label: "Scalping Terminal", icon: Terminal },
      { href: "/signals", label: "AI Signals", icon: Radio },
      { href: "/signals/pro", label: "Pro Signals", icon: Zap },
      { href: "/alert-center", label: "Alert Center", icon: AlertTriangle },
      { href: "/signal-transparency", label: "Signal Transparency", icon: FileText },
      { href: "/insights", label: "AI Insights", icon: Sparkles },
    ],
  },
  {
    label: "Market Intelligence",
    items: [
      { href: "/market-intelligence/terminal", label: "Terminal", icon: Terminal },
      { href: "/market-intelligence/analysis", label: "Advanced Analysis", icon: Layers },
      { href: "/market-intelligence/smart-money", label: "Smart Money", icon: Zap },
      { href: "/market-intelligence/backtest", label: "Backtesting", icon: MonitorPlay },
      { href: "/market-intelligence/strategy-lab", label: "Strategy Lab", icon: FlaskConical },
    ],
  },
  {
    label: "Strategy",
    items: [
      { href: "/strategy-lab", label: "Strategy Lab", icon: FlaskConical },
      { href: "/backtests", label: "Backtesting", icon: MonitorPlay },
      { href: "/walk-forward", label: "Walk-Forward", icon: TrendingUp },
      { href: "/monte-carlo", label: "Monte Carlo", icon: CandlestickChart },
      { href: "/equity-curve", label: "Equity Curve", icon: LineChart },
      { href: "/verified-performance", label: "Verified Performance", icon: Shield },
      { href: "/strategy-compare", label: "Strategy Compare", icon: BarChart3 },
    ],
  },
  {
    label: "Automation",
    items: [
      { href: "/workflows", label: "Workflow Automation", icon: GitBranch },
      { href: "/account/bots", label: "My Bots", icon: Bot },
      { href: "/copy-trading", label: "Copy Trading", icon: Copy },
      { href: "/account/trading-access", label: "MT5 Gateway", icon: Terminal },
      { href: "/trade-replay", label: "Trade Replay", icon: Rocket },
    ],
  },
  {
    label: "Marketplace",
    items: [
      { href: "/marketplace", label: "Marketplace", icon: Rocket },
      { href: "/account/purchases", label: "Purchases", icon: CreditCard },
      { href: "/account/licenses", label: "Licenses", icon: FileKey2 },
      { href: "/account/setfiles", label: "Set Files", icon: FileCode2 },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/account", label: "Account Home", icon: UserRound },
      { href: "/account/settings", label: "Settings", icon: Gauge },
      { href: "/account/affiliate", label: "Affiliates", icon: Rocket },
      { href: "/account/tools", label: "Tools", icon: Calculator },
      { href: "/alerts", label: "Alerts", icon: AlertTriangle },
      { href: "/alerts/history", label: "Alert History", icon: History },
      { href: "/alerts/tools", label: "Alert Tools", icon: Gauge },
    ],
  },
];

/**
 * AdminNav — canonical sidebar navigation for admin pages.
 */
export const ADMIN_NAV: NavGroup[] = [
  {
    label: "Admin",
    items: [
      { href: "/admin", label: "Overview", icon: LayoutDashboard },
      { href: "/admin/users", label: "Users", icon: UserRound },
      { href: "/admin/bots", label: "Bots", icon: Bot },
      { href: "/admin/signals", label: "Signals", icon: Radio },
      { href: "/admin/orders", label: "Orders", icon: Receipt },
      { href: "/admin/backtests", label: "Backtests", icon: MonitorPlay },
      { href: "/admin/live", label: "Live Accounts", icon: LineChart },
      { href: "/admin/copy-trading", label: "Copy Trading", icon: Copy },
      { href: "/admin/telegram", label: "Telegram", icon: Radio },
      { href: "/admin/tradingview", label: "TradingView", icon: CandlestickChart },
      { href: "/admin/licenses", label: "Licenses", icon: FileKey2 },
      { href: "/admin/trading-accounts", label: "Trading Accounts", icon: Terminal },
      { href: "/admin/developers", label: "Developers", icon: Bot },
      { href: "/admin/affiliates", label: "Affiliates", icon: Rocket },
      { href: "/admin/reviews", label: "Reviews", icon: FileText },
      { href: "/admin/setfiles", label: "Set Files", icon: FileCode2 },
      { href: "/admin/trading-licenses", label: "Trading Licenses", icon: Shield },
      { href: "/admin/whitelabel", label: "White Label", icon: Sparkles },
      { href: "/admin/settings", label: "Settings", icon: Gauge },
    ],
  },
];

/**
 * DeveloperNav — canonical sidebar navigation for developer pages.
 */
export const DEVELOPER_NAV: NavGroup[] = [
  {
    label: "Intelligence",
    items: [
      { href: "/admin/workflows", label: "Workflow Automation", icon: GitBranch },
      { href: "/admin/telegram", label: "Telegram Signals", icon: Radio },
      { href: "/admin/backtests", label: "Backtests", icon: MonitorPlay },
    ],
  },
];