// Candel proposals — intents a Candel prepared, per Candel
"use client";

import { Suspense } from "react";
import { LoadingState } from "@/components/ui/loading-state";
import { CandelScope } from "@/components/candel/CandelScope";
import { ProposalsPanel } from "@/components/candel/panels";

export default function CandelProposalsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading proposals" rows={3} />}>
      <CandelScope
        title="Proposals"
        subtitle="Intents your Candel prepared"
        render={(candelId) => <ProposalsPanel candelId={candelId} />}
      />
    </Suspense>
  );
}
