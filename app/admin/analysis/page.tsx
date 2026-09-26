import AdminShell from "@/components/admin/AdminShell";
import AnalysisWorkspace from "@/components/analytics/AnalysisWorkspace";

export const metadata = {
    title: "Market Analysis — Admin",
    description: "Live market analysis terminal for administration",
};

export default function AdminAnalysisPage() {
    return (
        <AdminShell title="Market Analysis" subtitle="Structure · Liquidity · Volume · Regime — live from your connected accounts">
            <AnalysisWorkspace stickyTop="top-0" />
        </AdminShell>
    );
}
