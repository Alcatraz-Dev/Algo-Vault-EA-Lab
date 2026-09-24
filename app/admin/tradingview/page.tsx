"use client";

import PineWorkspace from "@/components/tradingview/PineWorkspace";
import AdminShell from "@/components/admin/AdminShell";

export default function AdminTradingViewPage() {
    return (
        <AdminShell title="Trading Studio" subtitle="Shared Pine source and charts">
            <div className="mx-auto max-w-7xl space-y-6">
                <div className="flex items-start justify-between flex-wrap gap-4 border-b border-border pb-5" data-guide="page-header">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-foreground">Trading Studio</h1>
                        <p className="text-sm text-muted-foreground mt-1">
                            Prepare indicator and strategy source with AI assistance, save it as an admin workspace, then download it for publishing.
                        </p>
                    </div>
                </div>
                <PineWorkspace scope="admin" />
            </div>
        </AdminShell>
    );
}