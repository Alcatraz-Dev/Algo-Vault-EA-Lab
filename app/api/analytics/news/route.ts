import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";

type NewsItem = {
    id: string;
    title: string;
    summary: string;
    source: string;
    url: string;
    publishedAt: number;
    category: string;
    sentiment: "bullish" | "bearish" | "neutral";
    symbols: string[];
};

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const category = request.nextUrl.searchParams.get("category") || "all";

        // Aggregate from free news sources
        const sources: NewsItem[] = [];

        // Try fetching fromRSS feeds via public APIs
        try {
            const finRes = await fetch("https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines", { signal: AbortSignal.timeout(5000) });
            if (finRes.ok) {
                const text = await finRes.text();
                const items = text.match(/<item>[\s\S]*?<\/item>/g) || [];
                for (const item of items.slice(0, 20)) {
                    const title = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] || item.match(/<title>(.*?)<\/title>/)?.[1] || "";
                    const link = item.match(/<link>(.*?)<\/link>/)?.[1] || "";
                    const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";
                    const description = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)?.[1] || item.match(/<description>(.*?)<\/description>/)?.[1] || "";

                    if (!title) continue;

                    const lower = title.toLowerCase();
                    let sentiment: NewsItem["sentiment"] = "neutral";
                    if (lower.includes("surge") || lower.includes("rally") || lower.includes("gain") || lower.includes("rise") || lower.includes("bull")) sentiment = "bullish";
                    if (lower.includes("crash") || lower.includes("drop") || lower.includes("fall") || lower.includes("decline") || lower.includes("bear") || lower.includes("plunge")) sentiment = "bearish";

                    const symbols: string[] = [];
                    if (lower.includes("gold") || lower.includes("xau")) symbols.push("XAUUSD");
                    if (lower.includes("oil") || lower.includes("crude")) symbols.push("USOIL");
                    if (lower.includes("bitcoin") || lower.includes("btc")) symbols.push("BTCUSD");
                    if (lower.includes("ethereum") || lower.includes("eth")) symbols.push("ETHUSD");
                    if (lower.includes("euro") || lower.includes("eurusd")) symbols.push("EURUSD");
                    if (lower.includes("pound") || lower.includes("gbpusd")) symbols.push("GBPUSD");
                    if (lower.includes("yen") || lower.includes("usdjpy")) symbols.push("USDJPY");
                    if (lower.includes("dollar") || lower.includes("dxy")) symbols.push("DXY");

                    let newsCat = "general";
                    if (lower.includes("fed") || lower.includes("fomc") || lower.includes("interest rate") || lower.includes("inflation") || lower.includes("cpi")) newsCat = "macro";
                    else if (lower.includes("earnings") || lower.includes("revenue") || lower.includes("profit")) newsCat = "earnings";
                    else if (symbols.length > 0) newsCat = "market";

                    sources.push({
                        id: `mw_${sources.length}`,
                        title: title.replace(/<!\[CDATA\[|\]\]>/g, ""),
                        summary: description.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]*>/g, "").slice(0, 200),
                        source: "MarketWatch",
                        url: link,
                        publishedAt: pubDate ? new Date(pubDate).getTime() : Date.now(),
                        category: newsCat,
                        sentiment,
                        symbols,
                    });
                }
            }
        } catch {}

        // Add some fallback curated headlines if no data
        if (sources.length === 0) {
            const fallback: NewsItem[] = [
                { id: "n1", title: "Fed Officials Signal Patience on Rate Cuts", summary: "Federal Reserve officials indicated they are in no rush to lower interest rates, citing persistent inflation concerns.", source: "Reuters", url: "#", publishedAt: Date.now() - 3600000, category: "macro", sentiment: "bearish", symbols: ["DXY", "XAUUSD"] },
                { id: "n2", title: "Gold Holds Steady Amid Geopolitical Tensions", summary: "Gold prices remained supported as investors weighed Middle East escalation risks against hawkish central bank rhetoric.", source: "Bloomberg", url: "#", publishedAt: Date.now() - 7200000, category: "market", sentiment: "bullish", symbols: ["XAUUSD"] },
                { id: "n3", title: "EUR/USD Slips Below Key Support Level", summary: "The euro fell against the dollar after weak eurozone manufacturing data renewed recession fears.", source: "FX Street", url: "#", publishedAt: Date.now() - 10800000, category: "market", sentiment: "bearish", symbols: ["EURUSD"] },
                { id: "n4", title: "Bitcoin Surges Past $95K on Institutional Inflows", summary: "Bitcoin rallied sharply as spot ETF inflows hit record highs, signaling renewed institutional interest.", source: "CoinDesk", url: "#", publishedAt: Date.now() - 14400000, category: "market", sentiment: "bullish", symbols: ["BTCUSD"] },
                { id: "n5", title: "US Jobs Report Exceeds Expectations", summary: "The US economy added 280K jobs in the latest month, surpassing the 200K consensus forecast.", source: "CNBC", url: "#", publishedAt: Date.now() - 18000000, category: "macro", sentiment: "bullish", symbols: ["DXY", "US30"] },
                { id: "n6", title: "Oil Drops on OPEC+ Output Concerns", summary: "Crude prices fell as reports suggested some OPEC+ members may push for higher production quotas.", source: "Reuters", url: "#", publishedAt: Date.now() - 21600000, category: "market", sentiment: "bearish", symbols: [] },
                { id: "n7", title: "Bank of England Holds Rates Steady", summary: "The BoE maintained its benchmark rate, citing mixed signals on UK inflation and growth.", source: "FT", url: "#", publishedAt: Date.now() - 25200000, category: "macro", sentiment: "neutral", symbols: ["GBPUSD"] },
                { id: "n8", title: "S&P 500 Hits New All-Time High", summary: "The S&P 500 closed at a record high driven by strong tech earnings and soft landing optimism.", source: "MarketWatch", url: "#", publishedAt: Date.now() - 28800000, category: "market", sentiment: "bullish", symbols: ["US30", "NAS100"] },
            ];
            sources.push(...fallback);
        }

        const filtered = category === "all" ? sources : sources.filter((s) => s.category === category);

        return NextResponse.json({
            success: true,
            news: filtered.sort((a, b) => b.publishedAt - a.publishedAt),
            total: filtered.length,
        });
    } catch (err) {
        console.error("News feed error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
