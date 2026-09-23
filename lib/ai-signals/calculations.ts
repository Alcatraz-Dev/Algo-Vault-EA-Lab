/**
 * Client-safe signal financial calculation utilities.
 * Zero Node.js or server-admin dependencies. Safe for Client Components.
 */

export function calculateProfitUSD(
    symbol: string,
    direction: "BUY" | "SELL",
    entry: number,
    targetPrice: number,
    lotSize: number = 0.01
): number {
    if (!entry || !targetPrice || !lotSize) return 0;
    const diff = direction === "BUY" ? targetPrice - entry : entry - targetPrice;
    const sym = symbol.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");

    if (sym === "XAUUSD" || sym === "GOLD") return diff * 100 * lotSize;
    if (sym === "XAGUSD" || sym === "SILVER") return diff * 5000 * lotSize;
    if (
        sym.includes("US30") ||
        sym.includes("NAS100") ||
        sym.includes("SPX500") ||
        sym.includes("GER40") ||
        sym.includes("UK100") ||
        sym.includes("US500") ||
        sym.includes("BTC") ||
        sym.includes("ETH") ||
        sym.includes("SOL") ||
        sym.includes("XRP")
    ) {
        return diff * 1 * lotSize;
    }
    if (sym.includes("JPY")) {
        return (diff * 100000 * lotSize) / entry;
    }
    return diff * 100000 * lotSize;
}

export function formatMoney(amount: number): string {
    const abs = Math.abs(amount);
    if (abs >= 10000) return abs.toFixed(0);
    if (abs >= 1000) return abs.toFixed(1);
    return abs.toFixed(2);
}
