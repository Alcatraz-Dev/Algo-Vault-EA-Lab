/**
 * Marketing Media — AlgoVault asset library.
 *
 * Real AlgoVault visuals only. Every asset is a static file under
 * `marketing-video/assets/` or a documented capture source. No stock
 * footage is used unless explicitly labelled as such.
 */
export type MarketingAsset = {
    id: string;
    label: string;
    url: string;
    width?: number;
    height?: number;
    category: "market" | "ai" | "platform" | "brand" | "signal" | "workflow" | "analytics" | "trading";
    kind: "screenshot" | "chart" | "graphic" | "logo" | "overlay";
};

export const MARKETING_ASSETS: MarketingAsset[] = [
    { id: "01-market-hero", label: "Market hero", url: "/marketing-video/assets/01-market-hero.png", category: "market", kind: "chart" },
    { id: "02-market-intelligence", label: "Market intelligence", url: "/marketing-video/assets/02-market-intelligence.png", category: "ai", kind: "graphic" },
    { id: "03-ai-intelligence", label: "AI intelligence", url: "/marketing-video/assets/03-ai-intelligence.png", category: "ai", kind: "graphic" },
    { id: "04-lifecycle", label: "Lifecycle", url: "/marketing-video/assets/04-lifecycle.png", category: "platform", kind: "graphic" },
    { id: "05-backtesting", label: "Backtesting", url: "/marketing-video/assets/05-backtesting.png", category: "platform", kind: "screenshot" },
    { id: "06-signal-risk", label: "Signal risk", url: "/marketing-video/assets/06-signal-risk.png", category: "signal", kind: "graphic" },
    { id: "07-gateway", label: "Gateway", url: "/marketing-video/assets/07-gateway.png", category: "trading", kind: "screenshot" },
    { id: "08-market-replay", label: "Market replay", url: "/marketing-video/assets/08-market-replay.png", category: "market", kind: "screenshot" },
    { id: "09-live-monitoring", label: "Live monitoring", url: "/marketing-video/assets/09-live-monitoring.png", category: "trading", kind: "screenshot" },
    { id: "10-marketplace", label: "Marketplace", url: "/marketing-video/assets/10-marketplace.png", category: "platform", kind: "screenshot" },
    { id: "11-final-cta", label: "Final CTA", url: "/marketing-video/assets/11-final-cta.png", category: "brand", kind: "graphic" },
    { id: "12-signals-route", label: "Signals route", url: "/marketing-video/assets/12-signals-route.png", category: "signal", kind: "screenshot" },
    { id: "13-strategy-lab-route", label: "Strategy lab route", url: "/marketing-video/assets/13-strategy-lab-route.png", category: "platform", kind: "screenshot" },
    { id: "14-backtests-route", label: "Backtests route", url: "/marketing-video/assets/14-backtests-route.png", category: "platform", kind: "screenshot" },
    { id: "15-live-route", label: "Live route", url: "/marketing-video/assets/15-live-route.png", category: "trading", kind: "screenshot" },
    { id: "16-trading-route", label: "Trading route", url: "/marketing-video/assets/16-trading-route.png", category: "trading", kind: "screenshot" },
    { id: "17-copy-trading-route", label: "Copy trading route", url: "/marketing-video/assets/17-copy-trading-route.png", category: "platform", kind: "screenshot" },
    { id: "18-replay-route", label: "Replay route", url: "/marketing-video/assets/18-replay-route.png", category: "market", kind: "screenshot" },
    { id: "19-dashboard-route", label: "Dashboard route", url: "/marketing-video/assets/19-dashboard-route.png", category: "platform", kind: "screenshot" },
    { id: "20-tradingview-route", label: "TradingView route", url: "/marketing-video/assets/20-tradingview-route.png", category: "market", kind: "screenshot" },
    { id: "21-scanner-route", label: "Scanner route", url: "/marketing-video/assets/21-scanner-route.png", category: "market", kind: "screenshot" },
    { id: "22-alert-center-route", label: "Alert center route", url: "/marketing-video/assets/22-alert-center-route.png", category: "signal", kind: "screenshot" },
    { id: "logo-mark", label: "Logo mark", url: "/marketing-video/assets/logo-mark.png", category: "brand", kind: "logo" },
    { id: "header-logo", label: "Header logo", url: "/marketing-video/assets/header-logo.png", category: "brand", kind: "logo" },
];

export function getMarketingAssetLibrary(): MarketingAsset[] {
    return [...MARKETING_ASSETS];
}

export function lookupAsset(id: string): MarketingAsset | undefined {
    return MARKETING_ASSETS.find((a) => a.id === id);
}

export function assetsForCategory(category: MarketingAsset["category"]): MarketingAsset[] {
    return MARKETING_ASSETS.filter((a) => a.category === category);
}

export function assetsForFeature(feature: string): MarketingAsset[] {
    const f = feature.toLowerCase();
    if (/signal|ai|intelligence/.test(f)) return assetsForCategory("ai").concat(assetsForCategory("signal"));
    if (/market|chart|gold|xau/.test(f)) return assetsForCategory("market");
    if (/gateway|live|trade|exec/.test(f)) return assetsForCategory("trading");
    if (/marketplace|store|plugin/.test(f)) return assetsForCategory("platform");
    return MARKETING_ASSETS;
}