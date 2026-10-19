"use client";
export const dynamic = "force-dynamic";

import { Suspense } from "react";
import AccountShell from "@/components/account/AccountShell";
import VisualBuilderPage from "@/app/admin/bot-studio/builder/page";

export default function AccountBuilderPage() {
    return (
        <AccountShell title="Visual Strategy Builder" subtitle="Design strategies with a node-based editor.">
            {/* VisualBuilderPage calls useSearchParams(), which needs a Suspense boundary for static prerendering. */}
            <Suspense fallback={null}>
                <VisualBuilderPage />
            </Suspense>
        </AccountShell>
    );
}
