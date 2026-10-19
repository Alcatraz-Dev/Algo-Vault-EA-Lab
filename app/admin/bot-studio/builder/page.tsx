"use client";
export const dynamic = "force-dynamic";

import { Suspense } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { VisualStrategyBuilder } from "@/components/bot-studio/VisualStrategyBuilder";

export default function AdminVisualBuilderPage() {
    return (
        <AdminShell title="Visual Strategy Builder">
            {/* VisualStrategyBuilder calls useSearchParams(), which needs a Suspense boundary for static prerendering. */}
            <Suspense fallback={null}>
                <VisualStrategyBuilder />
            </Suspense>
        </AdminShell>
    );
}
