"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AccountShell from "@/components/account/AccountShell";
import {
    AITeamsWorkspace,
    INITIAL_HEADER_INFO,
    teamsEyebrow,
    teamsSubtitle,
    type AITeamsHeaderInfo,
} from "@/components/ai-trading-teams/teams-workspace";

/**
 * /account/ai-trading-teams — AI Trading Teams mounted inside the customer
 * area, so it inherits the account sidebar and the account page chrome. The
 * Pro badge renders on the same line as the page title.
 */
export default function AccountAITradingTeamsPage() {
    const router = useRouter();
    const [info, setInfo] = useState<AITeamsHeaderInfo>(INITIAL_HEADER_INFO);

    return (
        <AccountShell
            title="AI Trading Teams"
            subtitle={teamsSubtitle(info)}
            eyebrow={teamsEyebrow(info)}
            onBack={() => router.push("/account")}
        >
            <AITeamsWorkspace onHeaderInfo={setInfo} />
        </AccountShell>
    );
}
