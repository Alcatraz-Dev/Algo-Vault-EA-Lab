"use client";
export const dynamic = "force-dynamic";

import AccountShell from "@/components/account/AccountShell";
import DeploymentDetailPage from "@/app/admin/bot-studio/deployments/[botId]/page";

export default function AccountDeploymentDetailPage() {
    return (
        <AccountShell title="Bot Deployment" subtitle="Monitor and control bot runtime.">
            <DeploymentDetailPage />
        </AccountShell>
    );
}
