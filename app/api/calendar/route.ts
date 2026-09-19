import { NextResponse } from "next/server";

export type EconomicNewsItem = {
    id: string;
    date: string;
    timeUtc: string;
    currency: string;
    flag: string;
    title: string;
    impact: "High" | "Medium" | "Low";
    forecast: string;
    previous: string;
    actual?: string;
    eaActionAdvice: "PAUSE EA" | "CAUTION" | "NORMAL";
};

export async function GET() {
    try {
        const response = await fetch("https://n8n.w-v.co/webhook/forex-calendar", {
            next: { revalidate: 300 },
        });

        if (!response.ok) {
            return NextResponse.json({ success: true, updatedAt: Date.now(), count: 0, events: [] });
        }

        const data: unknown = await response.json();
        const events = Array.isArray(data)
            ? data.map((item, index): EconomicNewsItem => {
                const source = item as Record<string, unknown>;
                const impact = parseImpact(source.impact);
                const currency = String(source.country || source.currency || "USD").toUpperCase();
                return {
                    id: `calendar_${index}`,
                    date: String(source.date || ""),
                    timeUtc: String(source.time || ""),
                    currency,
                    flag: getCurrencyFlag(currency),
                    title: String(source.title || source.event || "Economic release"),
                    impact,
                    forecast: String(source.forecast || "—"),
                    previous: String(source.previous || "—"),
                    actual: source.actual ? String(source.actual) : undefined,
                    eaActionAdvice: impact === "High" ? "PAUSE EA" : impact === "Medium" ? "CAUTION" : "NORMAL",
                };
            })
            : [];

        return NextResponse.json({ success: true, updatedAt: Date.now(), count: events.length, events });
    } catch (error) {
        console.warn("Calendar feed unavailable:", error);
        return NextResponse.json({ success: true, updatedAt: Date.now(), count: 0, events: [] });
    }
}

function getCurrencyFlag(currency: string) {
    const flags: Record<string, string> = { USD: "US", EUR: "EU", GBP: "GB", JPY: "JP", AUD: "AU", CAD: "CA", CHF: "CH", NZD: "NZ" };
    return flags[currency] ? String.fromCodePoint(...[...flags[currency]].map((letter) => 127397 + letter.charCodeAt(0))) : "🌐";
}

function parseImpact(value: unknown): "High" | "Medium" | "Low" {
    const impact = String(value || "").toLowerCase();
    if (impact.includes("high") || impact.includes("red") || impact.includes("3")) return "High";
    if (impact.includes("medium") || impact.includes("orange") || impact.includes("2")) return "Medium";
    return "Low";
}
