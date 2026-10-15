import { getHomeData } from "@/lib/home-data";
import HomePage from "@/components/home/HomePage";
import { HomeNativeAd } from "@/components/growth/HomeNativeAd";

// Homepage figures come from Firebase Realtime Database and must be read at
// request time; prerendering would require production Admin credentials in CI.
export const dynamic = "force-dynamic";

export default async function Home() {
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
}