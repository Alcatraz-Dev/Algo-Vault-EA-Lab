import { getHomeData } from "@/lib/home-data";
import HomePage from "@/components/home/HomePage";
import { HomeNativeAd } from "@/components/growth/HomeNativeAd";

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