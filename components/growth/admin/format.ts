/** Formatting helpers shared by the Growth/Monetization admin UI. */

export function fmtCurrency(amount: number, currency = "USD", compact = false): string {
    try {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency,
            notation: compact ? "compact" : "standard",
            maximumFractionDigits: compact ? 1 : 2,
        }).format(Number(amount || 0));
    } catch {
        return `$${Number(amount || 0).toFixed(2)}`;
    }
}

export function fmtNumber(value: number): string {
    return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

export function fmtNumberCompact(value: number): string {
    try {
        return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value || 0));
    } catch {
        return String(value ?? 0);
    }
}

export function fmtDate(ms?: number): string {
    if (!ms) return "—";
    return new Date(ms).toLocaleDateString();
}

export function fmtDateTime(ms?: number): string {
    if (!ms) return "—";
    return new Date(ms).toLocaleString();
}

export function fmtTime(ms?: number): string {
    if (!ms) return "—";
    return new Date(ms).toLocaleTimeString();
}

export function fmtRelative(ms?: number): string {
    if (!ms) return "—";
    const diff = Date.now() - ms;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
    return new Date(ms).toLocaleDateString();
}

/** epoch ms → value for <input type="datetime-local"> */
export function toInputDateTime(ms?: number): string {
    if (!ms) return "";
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> → epoch ms (0 when empty/invalid) */
export function fromInputDateTime(value: string): number {
    if (!value) return 0;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : 0;
}

export function commaListToString(value: string[] | undefined): string {
    return (value || []).join(", ");
}

export function stringToCommaList(value: string): string[] {
    return value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}