"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import PineWorkspace from "@/components/tradingview/PineWorkspace";
import AdminShell from "@/components/admin/AdminShell";

export default function AdminTradingViewPage() {
    return (
        <AdminShell title="Trading Studio" subtitle="Shared Pine source and charts">
            <div className="mx-auto max-w-7xl">
                <Link href="/admin" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"><ArrowLeft size={16} />Back to admin</Link>
                <div className="mt-8 border-b border-border pb-6">
                    <p className="text-xs font-medium uppercase tracking-widest text-foreground/60">Admin Trading studio</p>
                    <h1 className="mt-2 text-3xl font-semibold text-foreground">Create shared Pine products</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Prepare indicator and strategy source with AI assistance, save it as an admin workspace, then download it for publishing.</p>
                </div>
                <div className="mt-6"><PineWorkspace scope="admin" /></div>
            </div>
        </AdminShell>
    );
}
