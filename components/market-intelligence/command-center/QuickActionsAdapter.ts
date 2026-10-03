/**
 * Quick Actions Adapter — Phase 8.
 * Reuses existing page links without duplicating logic.
 */
export interface QuickActionItem {
  label: string;
  href: string;
  available: boolean;
}

export interface QuickActionContext {
  backtestId?: string;
}

export function buildQuickActions(context?: QuickActionContext): QuickActionItem[] {
  return [
    { label: "Advanced Analysis", href: "/advanced-analysis", available: true },
    { label: "Backtest Terminal", href: "/market-intelligence/backtest", available: !!context?.backtestId || true },
    { label: "Research / OOS", href: "/market-intelligence/research", available: true },
    { label: "Strategy Research", href: "/strategy-research", available: true },
    { label: "Trading Studio", href: "/trading-studio", available: true },
  ];
}
