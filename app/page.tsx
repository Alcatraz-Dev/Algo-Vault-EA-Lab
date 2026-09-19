import { getHomeData } from "@/lib/home-data";
import HomePage from "@/components/home/HomePage";

export default async function Home() {
  const data = await getHomeData();
  return <HomePage data={data} />;
}
