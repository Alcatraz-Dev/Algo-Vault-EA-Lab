import {
  Activity,
  AlertTriangle,
  BarChart3,
  Beaker,
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
  ShieldCheck,
  Sparkles,
  Target,
  Terminal,
  TrendingUp,
  Trophy,
  UserRound,
  Wallet,
  Zap,
  Database,
  Server,
  Users,
  PuzzleIcon,
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
      { href: "/portfolio/intelligence", label: "Portfolio Intelligence", icon: Layers },
      { href: "/goals", label: "Goals", icon: Target },
      { href: "/account/performance-arena", label: "Performance Arena", icon: Trophy },
    ],
  },
  {
    label: "Markets",
    items: [
      { href: "/scanner", label: "Market Scanner", icon: Activity },
      { href: "/charts", label: "Charts", icon: CandlestickChart },
      { href: "/economic-calendar", label: "Economic Calendar", icon: Newspaper },
      { href: "/risk", label: "Risk Analysis", icon: Shield, pro: true },
    ],
  },
  {
    label: "Trading",
    items: [
      { href: "/account/terminal", label: "Terminal", icon: Terminal, pro: true },
      { href: "/account/trading", label: "Live Trading", icon: Terminal, pro: true },
      { href: "/trade-management", label: "Trade Management", icon: Layers, pro: true },
      { href: "/execution-analytics", label: "Execution Analytics", icon: Gauge, pro: true },
      { href: "/trade-journal", label: "Trade Journal", icon: ScrollText },
      { href: "/account-health", label: "Account Health", icon: Activity, pro: true },
      { href: "/statement", label: "Statement", icon: Receipt, pro: true },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/ai-trading-teams", label: "AI Trading Teams", icon: Users, pro: true },
      { href: "/ai-copilot", label: "AI Copilot", icon: Brain, pro: true },
      { href: "/signals", label: "AI Signals", icon: Radio },
      { href: "/signals/pro", label: "Pro Signals", icon: Zap, pro: true },
      { href: "/alert-center", label: "Alert Center", icon: AlertTriangle, pro: true },
      { href: "/signal-transparency", label: "Signal Transparency", icon: FileText },
      { href: "/insights", label: "AI Insights", icon: Sparkles, pro: true },
    ],
  },
  {
    label: "Market Intelligence",
    items: [
      { href: "/market-intelligence/terminal", label: "Terminal", icon: Terminal, pro: true },
      { href: "/market-intelligence/scalping", label: "AI Scalping Terminal", icon: Zap, pro: true },
      { href: "/market-intelligence/advanced", label: "Advanced Analysis", icon: Shield, pro: true },
      { href: "/market-intelligence/smart-money", label: "Smart Money", icon: Zap, pro: true },
      { href: "/market-intelligence/investigation", label: "Investigation", icon: ShieldCheck, pro: true },
      { href: "/market-intelligence/backtest", label: "Backtesting", icon: MonitorPlay, pro: true },
      { href: "/market-intelligence/research", label: "Research", icon: FlaskConical, pro: true },
      { href: "/market-intelligence/oos", label: "OOS Validation", icon: Target, pro: true },
      { href: "/market-intelligence/strategy-lab", label: "Strategy Lab", icon: FlaskConical, pro: true },
    ],
  },
  {
    label: "Strategy",
    items: [
      { href: "/strategy-lab", label: "Strategy Lab", icon: FlaskConical, pro: true },
      { href: "/strategy-research", label: "Strategy Research", icon: Beaker, pro: true },
      { href: "/backtests", label: "Backtesting", icon: MonitorPlay, pro: true },
      { href: "/walk-forward", label: "Walk-Forward", icon: TrendingUp, pro: true },
      { href: "/monte-carlo", label: "Monte Carlo", icon: CandlestickChart, pro: true },
      { href: "/equity-curve", label: "Equity Curve", icon: LineChart, pro: true },
      { href: "/verified-performance", label: "Verified Performance", icon: Shield },
      { href: "/strategy-compare", label: "Strategy Compare", icon: BarChart3, pro: true },
    ],
  },
  {
    label: "Automation",
    items: [
      { href: "/workflows", label: "Workflow Automation", icon: GitBranch, pro: true },
      { href: "/account/bots", label: "My Bots", icon: Bot, pro: true },
      { href: "/copy-trading", label: "Copy Trading", icon: Copy, pro: true },
      { href: "/account/trading-access", label: "MT5 Gateway", icon: Terminal, pro: true },
      { href: "/trade-replay", label: "Trade Replay", icon: Rocket, pro: true },
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
      { href: "/account/pro-trading-extension", label: "Pro Trading Extension", icon: PuzzleIcon },
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
      { href: "/admin/ai-agents", label: "AI Agents", icon: Bot },
      { href: "/admin/ai-trading-teams", label: "AI Teams", icon: Users },
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
      { href: "/admin/business-operations", label: "Business Operations", icon: Activity },
      { href: "/admin/business-operations/orders", label: "Business Orders", icon: ShieldCheck },
      { href: "/admin/business-operations/payments", label: "Business Payments", icon: Receipt },
      { href: "/admin/business-operations/licenses", label: "Business Licenses", icon: ShieldCheck },
      { href: "/admin/business-operations/financial", label: "Financial Overview", icon: Database },
      { href: "/admin/business-events", label: "Business Events", icon: Database },
      { href: "/admin/erpnext", label: "ERPNext", icon: Server },
      { href: "/admin/strategy-research", label: "Strategy Research", icon: FlaskConical },
      { href: "/admin/performance-arena", label: "Performance Arena", icon: Trophy },
      { href: "/admin/extensions", label: "Pro Extension", icon: PuzzleIcon },
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