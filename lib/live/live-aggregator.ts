import type { LiveActivity, LiveStats, CountryActivity, MarketShare } from "./live-types";

export const LIVE_ACTIVITY_MODE =
  process.env.NEXT_PUBLIC_LIVE_MODE === "production" ? "production" : "demo";

const COUNTRIES: Record<string, { lat: number; lng: number; code: string }> = {
  Sweden: { lat: 62, lng: 15, code: "SE" },
  "United States": { lat: 37.5, lng: -95, code: "US" },
  "United Kingdom": { lat: 55, lng: -3, code: "GB" },
  Germany: { lat: 51, lng: 10, code: "DE" },
  France: { lat: 46, lng: 2, code: "FR" },
  UAE: { lat: 23.5, lng: 54, code: "AE" },
  Tunisia: { lat: 34, lng: 9, code: "TN" },
  Canada: { lat: 56, lng: -106, code: "CA" },
  Australia: { lat: -25, lng: 133, code: "AU" },
  Japan: { lat: 36, lng: 138, code: "JP" },
  Singapore: { lat: 1.5, lng: 103.8, code: "SG" },
  Switzerland: { lat: 46.8, lng: 8.2, code: "CH" },
  Netherlands: { lat: 52, lng: 5, code: "NL" },
  Italy: { lat: 41.9, lng: 12.5, code: "IT" },
  Spain: { lat: 40, lng: -3.5, code: "ES" },
  Brazil: { lat: -14, lng: -51.9, code: "BR" },
  Argentina: { lat: -38.4, lng: -63.6, code: "AR" },
  India: { lat: 20.6, lng: 78.9, code: "IN" },
  China: { lat: 35, lng: 104.2, code: "CN" },
  Russia: { lat: 61, lng: 105.3, code: "RU" },
  SouthAfrica: { lat: -30.6, lng: 22.9, code: "ZA" },
  Nigeria: { lat: 9.1, lng: 8.7, code: "NG" },
  Egypt: { lat: 26.8, lng: 30.8, code: "EG" },
  Mexico: { lat: 23.6, lng: -102.5, code: "MX" },
  Indonesia: { lat: -0.8, lng: 113.9, code: "ID" },
  Thailand: { lat: 15.8, lng: 100.9, code: "TH" },
  Vietnam: { lat: 14.5, lng: 108.2, code: "VN" },
  Turkey: { lat: 39, lng: 35.2, code: "TR" },
  Poland: { lat: 51.9, lng: 19.1, code: "PL" },
  Morocco: { lat: 31.8, lng: -7.1, code: "MA" },
  Chile: { lat: -33.4, lng: -70.7, code: "CL" },
  Colombia: { lat: 4.7, lng: -74.1, code: "CO" },
  Peru: { lat: -9.2, lng: -75.0, code: "PE" },
  SaudiArabia: { lat: 23.9, lng: 45.1, code: "SA" },
  Israel: { lat: 31.0, lng: 34.9, code: "IL" },
  Pakistan: { lat: 30.4, lng: 69.3, code: "PK" },
  Ukraine: { lat: 49.0, lng: 31.2, code: "UA" },
  Greece: { lat: 39.7, lng: 21.8, code: "GR" },
  Norway: { lat: 60.5, lng: 8.5, code: "NO" },
  Denmark: { lat: 56, lng: 10, code: "DK" },
  Finland: { lat: 61.9, lng: 25.7, code: "FI" },
  Portugal: { lat: 39.4, lng: -8.2, code: "PT" },
  NewZealand: { lat: -41.0, lng: 174.9, code: "NZ" },
};

const MARKETS = ["XAUUSD", "BTCUSD", "EURUSD", "NAS100", "GBPUSD", "US500"];
const TYPES = [
  "smart_money",
  "market_analysis",
  "scalping",
  "signal",
  "ai_analysis",
] as const;

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function deterministicSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h << 5) - h + id.charCodeAt(i);
  return Math.abs(h) % 10000;
}

function pseudoRand(seed: number): number {
  const s = Math.sin(seed) * 10000;
  return s - Math.floor(s);
}

export function generateDemoActivities(count = 30): LiveActivity[] {
  const rows: LiveActivity[] = [];
  const keys = Object.keys(COUNTRIES);
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const seed = i * 7919 + 137;
    const country = keys[Math.floor(pseudoRand(seed) * keys.length)];
    const meta = COUNTRIES[country];
    const id = `demo-${i}-${deterministicSeed(country + String(i))}`;
    const market = MARKETS[Math.floor(pseudoRand(seed + 1) * MARKETS.length)];
    const type = TYPES[Math.floor(pseudoRand(seed + 2) * TYPES.length)];
    const dir = ["bullish", "bearish", "neutral"][Math.floor(pseudoRand(seed + 3) * 3)] as "bullish" | "bearish" | "neutral";
    rows.push({
      id,
      country,
      countryCode: meta.code,
      latitude: meta.lat + (Math.sin(i) * 3),
      longitude: meta.lng + (Math.cos(i) * 4),
      market,
      activityType: type,
      direction: dir,
      intensity: 0.5 + pseudoRand(seed + 4) * 0.5,
      timestamp: now - i * 4000 - Math.floor(pseudoRand(seed + 5) * 3000),
    });
  }
  return rows.sort((a, b) => b.timestamp - a.timestamp);
}

export function getLiveStats(): LiveStats {
  return {
    activeUsers: 2481,
    activeMarkets: 37,
    aiAnalyses: 6821,
    liveSignals: 18294,
  };
}

export function getCountryActivity(): CountryActivity[] {
  return [
    { country: "United States", countryCode: "US", percentage: 28, sessions: 695, aiAnalyses: 420, markets: 12, topMarket: "BTCUSD" },
    { country: "United Kingdom", countryCode: "GB", percentage: 14, sessions: 347, aiAnalyses: 210, markets: 8, topMarket: "EURUSD" },
    { country: "Germany", countryCode: "DE", percentage: 9, sessions: 223, aiAnalyses: 150, markets: 5, topMarket: "XAUUSD" },
    { country: "Sweden", countryCode: "SE", percentage: 6, sessions: 149, aiAnalyses: 82, markets: 9, topMarket: "XAUUSD" },
    { country: "France", countryCode: "FR", percentage: 5, sessions: 124, aiAnalyses: 90, markets: 4, topMarket: "EURUSD" },
    { country: "UAE", countryCode: "AE", percentage: 4, sessions: 99, aiAnalyses: 60, markets: 3, topMarket: "NAS100" },
    { country: "Tunisia", countryCode: "TN", percentage: 3, sessions: 74, aiAnalyses: 45, markets: 2, topMarket: "XAUUSD" },
    { country: "Other", countryCode: "OTHER", percentage: 31, sessions: 770, aiAnalyses: 380, markets: 10, topMarket: "BTCUSD" },
  ];
}

export function getMarketShares(): MarketShare[] {
  return [
    { market: "XAUUSD", share: 42 },
    { market: "BTCUSD", share: 31 },
    { market: "EURUSD", share: 14 },
    { market: "NAS100", share: 8 },
    { market: "GBPUSD", share: 5 },
  ];
}

export function aggregateFromEvents(events: LiveActivity[]): LiveActivity[] {
  // In production this would aggregate by country/market; here we just cap and sort
  const seen = new Set<string>();
  const out: LiveActivity[] = [];
  for (const e of events) {
    const key = `${e.countryCode}-${e.market}-${e.activityType}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(e);
    }
    if (out.length >= 100) break;
  }
  return out;
}
