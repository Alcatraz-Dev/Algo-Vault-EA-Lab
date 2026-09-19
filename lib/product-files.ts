export type ProductFileRule = {
    label: string;
    extensions: string[];
    description: string;
};

const MT5_RULE: ProductFileRule = {
    label: "MT5 file",
    extensions: [".ex5", ".mq5"],
    description: "MT5 compiled or source file",
};

const MT4_RULE: ProductFileRule = {
    label: "MT4 file",
    extensions: [".ex4", ".mq4"],
    description: "MT4 compiled or source file",
};

const PINE_RULE: ProductFileRule = {
    label: "Pine Script",
    extensions: [".pine"],
    description: "TradingView Pine Script file",
};

export function getProductFileRule(productType?: string, platform?: string): ProductFileRule {
    const normalizedPlatform = String(platform || "").toLowerCase();
    const normalizedType = String(productType || "").toLowerCase();

    if (
        normalizedPlatform === "tradingview" ||
        normalizedType === "pine_indicator" ||
        normalizedType === "pine_strategy"
    ) {
        return PINE_RULE;
    }

    if (normalizedPlatform === "mt4") {
        return MT4_RULE;
    }

    return MT5_RULE;
}

export function isAllowedProductFileName(
    fileName: string,
    productType?: string,
    platform?: string
) {
    if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) return false;
    const lower = fileName.toLowerCase();
    return getProductFileRule(productType, platform).extensions.some((ext) => lower.endsWith(ext));
}

export function formatProductFileExtensions(productType?: string, platform?: string) {
    return getProductFileRule(productType, platform).extensions.join(", ");
}

export function safeProductVersionName(version: string) {
    return version
        .trim()
        .replace(/\./g, "_")
        .replace(/[^a-zA-Z0-9_-]/g, "_");
}
