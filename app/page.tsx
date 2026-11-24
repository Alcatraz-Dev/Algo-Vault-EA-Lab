import { getHomeData, type HomeData } from "@/lib/home-data";
import { isFirebaseAdminConfigured } from "@/lib/firebase-admin-config";
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

const OFFLINE_NOTICE =
  "Live marketplace data is currently unavailable. Showing the offline homepage — your workspace and login still work.";

export default async function Home() {
  let data: HomeData = OFFLINE_HOME_DATA;
  let dataNotice: string | undefined = OFFLINE_NOTICE;

  // A missing Admin config is an expected state (local development and the
  // packaged desktop app, which never receives credentials), not a failure.
  // Skip the fetch so it is reported as offline rather than logged as an error
  // that the dev overlay would surface as a crash.
  if (!isFirebaseAdminConfigured()) {
    console.warn(
      "Homepage data offline: Firebase Admin credentials are not configured. Showing the offline homepage."
    );
  } else {
    try {
      data = await getHomeData();
      dataNotice = undefined;
    } catch (error) {
      // Controlled degradation: log only the message (never credentials or
      // stacks with secrets) and render usable UI with an explicit notice.
      console.error(
        "Homepage data unavailable:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  return (
    <>
      <HomePage data={data} dataNotice={dataNotice} />
      {/* One subtle native/sponsored placement after the hero (non-intrusive).
          Renders nothing unless an active, eligible placement exists. */}
      <div className="mx-auto max-w-7xl px-6 pb-10">
        <HomeNativeAd />
      </div>
    </>
  );
}