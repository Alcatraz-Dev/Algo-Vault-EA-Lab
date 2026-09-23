/**
 * Growth Engine — analytics calculations.
 *
 * Pure module. Every function returns real computed values from the inputs it
 * is given; when the underlying data is missing or sparse the functions return
 * null so callers can render "Insufficient data" instead of fabricating a
 * number.
 */

export type RateResult = {
    value: number;
    numerator: number;
    denominator: number;
    /** True when the denominator was too small for a meaningful rate. */
    insufficient: boolean;
} | null;

const MIN_DENOMINATOR = 5;

function rate(numerator: number, denominator: number, opts?: { minDenominator?: number }): RateResult {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator < 0 || denominator < 0) {
        return null;
    }
    const min = opts?.minDenominator ?? MIN_DENOMINATOR;
    if (denominator === 0) return { value: 0, numerator, denominator, insufficient: true };
    return {
        value: denominator < min ? (numerator / denominator) * 100 : (numerator / denominator) * 100,
        numerator,
        denominator,
        insufficient: denominator < min,
    };
}

export const ctr = (clicks: number, impressions: number): RateResult => rate(clicks, impressions);
export const cvr = (conversions: number, clicks: number): RateResult => rate(conversions, clicks);
export const affiliateConversionRate = (conversions: number, clicks: number): RateResult => rate(conversions, clicks);
export const activationRate = (activated: number, registrations: number): RateResult => rate(activated, registrations);
export const registrationToSubscription = (subscribers: number, registrations: number): RateResult =>
    rate(subscribers, registrations);
export const marketplaceConversion = (sales: number, visitors: number): RateResult => rate(sales, visitors);

export function cpa(spend: number, conversions: number): number | null {
    if (!Number.isFinite(spend) || !Number.isFinite(conversions) || spend < 0 || conversions <= 0) return null;
    return spend / conversions;
}

export function cac(spend: number, newUsers: number): number | null {
    if (!Number.isFinite(spend) || !Number.isFinite(newUsers) || spend < 0 || newUsers <= 0) return null;
    return spend / newUsers;
}

export function roas(revenue: number, spend: number): number | null {
    if (!Number.isFinite(revenue) || !Number.isFinite(spend) || revenue < 0 || spend <= 0) return null;
    return revenue / spend;
}

/** Revenue per 1000 impressions — only meaningful when impressions exist. */
export function rpm(revenue: number, impressions: number): number | null {
    if (!Number.isFinite(revenue) || !Number.isFinite(impressions) || revenue < 0 || impressions <= 0) return null;
    return (revenue / impressions) * 1000;
}

export function revenuePerVisitor(revenue: number, visitors: number): number | null {
    if (!Number.isFinite(revenue) || !Number.isFinite(visitors) || revenue < 0 || visitors <= 0) return null;
    return revenue / visitors;
}

export function revenuePerUser(revenue: number, users: number): number | null {
    if (!Number.isFinite(revenue) || !Number.isFinite(users) || revenue < 0 || users <= 0) return null;
    return revenue / users;
}

/** Percentage change vs previous period. Null when previous is unusable. */
export function pctChange(current: number, previous: number): number | null {
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
    return ((current - previous) / Math.abs(previous)) * 100;
}

/** Serializes a nullable metric to a display string with an "insufficient" marker. */
export function metricToString(value: RateResult | number | null, opts?: { digits?: number; suffix?: string }): string {
    const digits = opts?.digits ?? 2;
    const suffix = opts?.suffix ?? "";
    if (value === null) return "Insufficient data";
    if (typeof value === "number") return `${value.toFixed(digits)}${suffix}`;
    if (value.insufficient) return "Insufficient data";
    return `${value.value.toFixed(digits)}${suffix}`;
}

/** Strictly increasing date keys between two timestamps: YYYY-MM-DD. */
export function dateRangeKeys(start: number, end: number): string[] {
    const keys: string[] = [];
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return keys;
    const cursor = new Date(start);
    const stop = new Date(end);
    while (cursor <= stop) {
        keys.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return keys;
}

export function isoWeekKey(ts: number): string {
    const date = new Date(ts);
    const day = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - day + 3);
    const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function monthKey(ts: number): string {
    return new Date(ts).toISOString().slice(0, 7);
}

/** Group a list of timestamped values into buckets for trend charts. */
export function bucketize(
    items: { ts: number; value: number }[],
    mode: "day" | "week" | "month"
): { key: string; value: number; count: number }[] {
    const buckets = new Map<string, { value: number; count: number }>();
    const keyOf = (ts: number) => (mode === "day" ? new Date(ts).toISOString().slice(0, 10) : mode === "week" ? isoWeekKey(ts) : monthKey(ts));
    for (const item of items) {
        const key = keyOf(item.ts);
        const current = buckets.get(key) || { value: 0, count: 0 };
        current.value += item.value;
        current.count += 1;
        buckets.set(key, current);
    }
    return [...buckets.entries()]
        .map(([key, bucket]) => ({ key, ...bucket }))
        .sort((a, b) => (a.key < b.key ? -1 : 1));
}