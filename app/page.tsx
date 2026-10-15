import { getHomeData, type HomeData } from "@/lib/home-data";
import HomePage from "@/components/home/HomePage";
import { HomeNativeAd } from "@/components/growth/HomeNativeAd";

// Homepage figures come from Firebase Realtime Database and must be read at
// request time; prerendering would require production Admin credentials in CI.
export const dynamic = "force-dynamic";

/**
 * Controlled fallback when the Admin backend is missing or unreachable
 * (notably the packaged desktop app, which never receives Admin
 * credentials). Zeros/empties are shown together with an explicit notice —
 * never presented as live figures.
 */
const OFFLINE_HOME_DATA: HomeData = {
  stats: { strategies: 0, backtests: 0, averageRating: 0, reviewCount: 0 },
  featured: [],
  latestBacktests: [],
  backtestAnalytics: {
    total: 0,
    analyzableCount: 0,
    avgWinRate: 0,
    avgMaxDrawdown: 0,
    avgReturnPct: 0,
    totalNetProfit: 0,
    positiveCount: 0,
    recent: [],
  },
  previewBacktests: false,
};

export default async function Home() {
  try {
    const data = await getHomeData();
    return (
      <>
        <HomePage data={data} />
        {/* One subtle native/sponsored placement after the hero (non-intrusive).
            Renders nothing unless an active, eligible placement exists. */}
        <div className="mx-auto max-w-7xl px-6 pb-10">
          <HomeNativeAd />
        </div>
      </>
    );
  } catch (error) {
    // Controlled degradation: log only the message (never credentials or
    // stacks with secrets) and render usable UI with an explicit notice.
    console.error(
      "Homepage data unavailable:",
      error instanceof Error ? error.message : String(error)
    );
    return (
      <>
        <HomePage data={OFFLINE_HOME_DATA} dataNotice="Live marketplace data is currently unavailable. Showing the offline homepage — your workspace and login still work." />
        <div className="mx-auto max-w-7xl px-6 pb-10">
          <HomeNativeAd />
        </div>
      </>
    );
  }
}