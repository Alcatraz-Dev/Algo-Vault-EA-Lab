import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";

type ImpactEvent = {
    id: string;
    title: string;
    country: string;
    flag: string;
    date: string;
    time: string;
    impact: "high" | "medium" | "low";
    forecast: string;
    previous: string;
    actual: string | null;
    currency: string;
    description: string;
};

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const now = new Date();
        const events: ImpactEvent[] = [];

        // Generate realistic upcoming economic events
        const highImpactEvents: Omit<ImpactEvent, "id">[] = [
            { title: "Non-Farm Payrolls", country: "United States", flag: "🇺🇸", date: getNextFriday(), time: "08:30", impact: "high", forecast: "180K", previous: "216K", actual: null, currency: "USD", description: "Change in the number of employed people during the previous month, excluding farm workers." },
            { title: "Consumer Price Index (CPI) YoY", country: "United States", flag: "🇺🇸", date: getNextWednesday(), time: "08:30", impact: "high", forecast: "3.2%", previous: "3.4%", actual: null, currency: "USD", description: "Change in the price of goods and services purchased by consumers." },
            { title: "FOMC Statement", country: "United States", flag: "🇺🇸", date: getNextWeekWednesday(), time: "14:00", impact: "high", forecast: "—", previous: "5.50%", actual: null, currency: "USD", description: "Federal Open Market Committee interest rate decision and monetary policy statement." },
            { title: "ECB Interest Rate Decision", country: "Eurozone", flag: "🇪🇺", date: getNextThursday(), time: "12:45", impact: "high", forecast: "4.50%", previous: "4.50%", actual: null, currency: "EUR", description: "European Central Bank main refinancing rate decision." },
            { title: "GDP (QoQ) Preliminary", country: "United Kingdom", flag: "🇬🇧", date: getNextThursday(), time: "07:00", impact: "high", forecast: "0.2%", previous: "-0.1%", actual: null, currency: "GBP", description: "Change in the inflation-adjusted value of all goods and services produced by the economy." },
            { title: "Bank of Japan Policy Rate", country: "Japan", flag: "🇯🇵", date: getNextFriday(), time: "03:00", impact: "high", forecast: "0.10%", previous: "0.10%", actual: null, currency: "JPY", description: "BOJ short-term interest rate target." },
            { title: "CPI (YoY)", country: "Eurozone", flag: "🇪🇺", date: getDaysFromNow(3), time: "11:00", impact: "high", forecast: "2.7%", previous: "2.9%", actual: null, currency: "EUR", description: "Consumer price index change from the same period last year." },
        ];

        const mediumImpactEvents: Omit<ImpactEvent, "id">[] = [
            { title: "Retail Sales MoM", country: "United States", flag: "🇺🇸", date: getDaysFromNow(5), time: "08:30", impact: "medium", forecast: "0.3%", previous: "0.6%", actual: null, currency: "USD", description: "Change in the total value of sales at the retail level." },
            { title: "Unemployment Rate", country: "United Kingdom", flag: "🇬🇧", date: getDaysFromNow(4), time: "07:00", impact: "medium", forecast: "4.2%", previous: "4.2%", actual: null, currency: "GBP", description: "Percentage of the total labor force that is unemployed." },
            { title: "Trade Balance", country: "United States", flag: "🇺🇸", date: getDaysFromNow(2), time: "08:30", impact: "medium", forecast: "-$62.2B", previous: "-$64.5B", actual: null, currency: "USD", description: "Difference between imports and exports of goods and services." },
            { title: "GDP (QoQ)", country: "Japan", flag: "🇯🇵", date: getDaysFromNow(6), time: "18:50", impact: "medium", forecast: "1.2%", previous: "-2.9%", actual: null, currency: "JPY", description: "Annualized change in the inflation-adjusted value of all goods and services produced." },
            { title: "Employment Change", country: "Canada", flag: "🇨🇦", date: getDaysFromNow(5), time: "08:30", impact: "medium", forecast: "20.0K", previous: "25.0K", actual: null, currency: "CAD", description: "Change in the number of employed people." },
            { title: "Consumer Confidence", country: "Eurozone", flag: "🇪🇺", date: getDaysFromNow(3), time: "10:00", impact: "medium", forecast: "-16.0", previous: "-16.1", actual: null, currency: "EUR", description: "Survey of about 2,300 consumers about their view of the economy." },
        ];

        const lowImpactEvents: Omit<ImpactEvent, "id">[] = [
            { title: "Building Permits", country: "United States", flag: "🇺🇸", date: getDaysFromNow(4), time: "08:30", impact: "low", forecast: "1.48M", previous: "1.46M", actual: null, currency: "USD", description: "Number of new building permits issued." },
            { title: "CPI (MoM)", country: "Japan", flag: "🇯🇵", date: getDaysFromNow(5), time: "18:30", impact: "low", forecast: "0.2%", previous: "0.2%", actual: null, currency: "JPY", description: "Change in the price of goods and services purchased by consumers." },
            { title: "M4 Money Supply", country: "United Kingdom", flag: "🇬🇧", date: getDaysFromNow(4), time: "09:30", impact: "low", forecast: "0.3%", previous: "0.1%", actual: null, currency: "GBP", description: "Change in the total amount of M4 money supply in circulation." },
        ];

        [...highImpactEvents, ...mediumImpactEvents, ...lowImpactEvents].forEach((event, i) => {
            events.push({ ...event, id: `eco_${i}` });
        });

        return NextResponse.json({
            success: true,
            events: events.sort((a, b) => {
                const da = new Date(`${a.date}T${a.time}`);
                const db = new Date(`${b.date}T${b.time}`);
                return da.getTime() - db.getTime();
            }),
        });
    } catch (err) {
        console.error("Economic impact error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

function getNextFriday(): string {
    const d = new Date();
    d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
    return d.toISOString().split("T")[0];
}

function getNextWednesday(): string {
    const d = new Date();
    d.setDate(d.getDate() + ((3 - d.getDay() + 7) % 7 || 7));
    return d.toISOString().split("T")[0];
}

function getNextWeekWednesday(): string {
    const d = new Date();
    d.setDate(d.getDate() + 7 + ((3 - d.getDay() + 7) % 7 || 7));
    return d.toISOString().split("T")[0];
}

function getNextThursday(): string {
    const d = new Date();
    d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7 || 7));
    return d.toISOString().split("T")[0];
}

function getDaysFromNow(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split("T")[0];
}
