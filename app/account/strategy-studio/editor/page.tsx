"use client";
export const dynamic = "force-dynamic";

import { Suspense } from "react";
import AccountShell from "@/components/account/AccountShell";
import AvScriptEditorPage from "@/app/admin/bot-studio/editor/page";

export default function AccountEditorPage() {
    return (
        <AccountShell title="AvScript Editor" subtitle="Write and validate AVS strategies.">
            {/* AvScriptEditorPage calls useSearchParams(), which needs a Suspense boundary for static prerendering. */}
            <Suspense fallback={null}>
                <AvScriptEditorPage embedded />
            </Suspense>
        </AccountShell>
    );
}
