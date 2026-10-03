import {
  Activity,
  Bot,
  Code2,
  Copy,
  CreditCard,
  DollarSign,
  FileCode2,
  FileKey2,
  FlaskConical,
  GitBranch,
  LayoutDashboard,
  LineChart,
  MessageSquare,
  MonitorPlay,
  Palette,
  Plug,
  Puzzle,
  Radio,
  RotateCcw,
  Settings,
  ShoppingCart,
  Sparkles,
  Target,
  Users,
  Megaphone,
  BarChart3,
  Database,
  Server,
  ShieldCheck,
  Zap,
} from "lucide-react";
import type { NavGroup } from "@/components/layout/AppShell";

/**
 * AdminNav — canonical sidebar navigation for the admin console.
 * Updated to match new design spec structure.
 */
export const ADMIN_NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Marketplace",
    items: [
      { href: "/admin/bots", label: "Bots / Products", icon: Bot },
      { href: "/admin/setfiles", label: "Set Files", icon: FileCode2 },
      { href: "/admin/trading-licenses", label: "Trading Licenses", icon: FileKey2 },
    ],
  },
  {
    label: "Business Operations",
    items: [
      { href: "/admin/business-operations", label: "Overview", icon: Activity },
      { href: "/admin/business-operations/orders", label: "Orders", icon: ShieldCheck },
      { href: "/admin/business-operations/payments", label: "Payments", icon: Database },
      { href: "/admin/business-operations/licenses", label: "Licenses", icon: ShieldCheck },
      { href: "/admin/business-operations/financial", label: "Financial Overview", icon: Database },
    ],
  },
  {
    label: "Commerce",
    items: [
      { href: "/admin/orders", label: "Orders", icon: ShoppingCart },
      { href: "/admin/licenses", label: "Licenses", icon: FileKey2 },
      { href: "/admin/affiliates", label: "Affiliates", icon: DollarSign },
      { href: "/admin/business-events", label: "Business Events", icon: Database },
      { href: "/admin/erpnext", label: "ERPNext", icon: Server },
    ],
  },
  {
    label: "Trading",
    items: [
      { href: "/admin/analysis", label: "Market Analysis", icon: BarChart3 },
      { href: "/admin/live", label: "Live Accounts", icon: Activity },
      { href: "/admin/trading-accounts", label: "Trading Accounts", icon: LineChart },
      { href: "/admin/copy-trading", label: "Copy Trading", icon: Copy },
      { href: "/trade-replay", label: "Trade Replay", icon: RotateCcw },
      { href: "/admin/tradingview", label: "Trading Studio", icon: LineChart },
      { href: "/account/ai-execution", label: "AI Execution", icon: Zap },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/admin/ai-agents", label: "AI Agents", icon: Bot },
      { href: "/admin/ai-trading-teams", label: "AI Trading Teams", icon: Sparkles },
      { href: "/admin/workflows", label: "Workflow Automation", icon: GitBranch },
      { href: "/admin/strategy-research", label: "Strategy Research", icon: FlaskConical },
      { href: "/admin/telegram", label: "Telegram Signals", icon: Radio },
      { href: "/admin/backtests", label: "Backtests", icon: MonitorPlay },
      { href: "/admin/analysis", label: "Analysis", icon: BarChart3 },
      { href: "/market-intelligence/scalping", label: "AI Scalping Terminal", icon: Zap },
      { href: "/account/scalping-terminal", label: "Pro Scalping Terminal", icon: Zap },
      { href: "/market-intelligence/advanced", label: "Advanced Analysis", icon: ShieldCheck },
    ],
  },
  {
    label: "Plugins",
    items: [
      { href: "/admin/plugins", label: "Plugins", icon: Plug },
      { href: "/admin/plugins/ai-studio", label: "AI Studio", icon: Sparkles },
      { href: "/admin/extensions", label: "Extensions", icon: Puzzle },
    ],
  },
  {
    label: "Community",
    items: [
      { href: "/admin/users", label: "Users", icon: Users },
      { href: "/admin/developers", label: "Developers", icon: Code2 },
      { href: "/admin/reviews", label: "Reviews", icon: MessageSquare },
    ],
  },
  {
    label: "Growth",
    items: [
      { href: "/admin/growth", label: "Growth Overview", icon: BarChart3 },
      { href: "/admin/growth/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/admin/growth/channels", label: "Channels", icon: Radio },
    ],
  },
  {
    label: "Monetization",
    items: [
      { href: "/admin/monetization", label: "Monetization", icon: CreditCard },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/agent", label: "Agent IDE", icon: Sparkles },
      { href: "/goals", label: "Goals", icon: Target },
      { href: "/admin/whitelabel", label: "Whitelabel", icon: Palette },
      { href: "/admin/settings", label: "Settings", icon: Settings },
    ],
  },
];