import AdminShell from "@/components/admin/AdminShell";
import AnalysisWorkspace from "@/components/analytics/AnalysisWorkspace";

export const metadata = {
    title: "Market Analysis — Admin",
    description: "Live market analysis terminal for administration",
};

export default function AdminAnalysisPage() {
    return (
        <AdminShell title="Market Analysis" subtitle="Structure · Liquidity · Volume · Regime — live from your connected accounts">
            {/* Default sticky offset: below the shell's sticky header. */}
            <AnalysisWorkspace />
        </AdminShell>
    );
}
