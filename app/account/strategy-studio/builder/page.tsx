"use client";
export const dynamic = "force-dynamic";

import { Suspense } from "react";
import AccountShell from "@/components/account/AccountShell";
import { VisualStrategyBuilder } from "@/components/bot-studio/VisualStrategyBuilder";

export default function AccountBuilderPage() {
    return (
        <AccountShell title="Visual Strategy Builder" subtitle="Design strategies with a node-based editor.">
            {/* VisualStrategyBuilder calls useSearchParams(), which needs a Suspense boundary for static prerendering. */}
            <Suspense fallback={null}>
                <VisualStrategyBuilder />
            </Suspense>
        </AccountShell>
    );
}
