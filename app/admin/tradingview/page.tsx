"use client";

import PineWorkspace from "@/components/tradingview/PineWorkspace";
import AdminShell from "@/components/admin/AdminShell";
import { PageHeader } from "@/components/ui/page-header";

export default function AdminTradingViewPage() {
    return (
        <AdminShell title="Trading Studio" subtitle="Shared Pine source and charts">
            <div className="mx-auto max-w-7xl space-y-6">
                <PageHeader
                    title="Trading Studio"
                    subtitle="Prepare indicator and strategy source with AI assistance, save it as an admin workspace, then download it for publishing."
                    className="border-b border-border pb-5"
                />
                <PineWorkspace scope="admin" />
            </div>
        </AdminShell>
    );
}