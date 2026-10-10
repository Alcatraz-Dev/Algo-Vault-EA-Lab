// Candel approvals — the human-in-the-loop inbox, per Candel
"use client";

import { Suspense } from "react";
import { LoadingState } from "@/components/ui/loading-state";
import { CandelScope } from "@/components/candel/CandelScope";
import { ApprovalsPanel } from "@/components/candel/panels";

export default function CandelApprovalsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading approvals" rows={3} />}>
      <CandelScope
        title="Approvals"
        subtitle="Live actions waiting on your decision"
        render={(candelId) => <ApprovalsPanel candelId={candelId} />}
      />
    </Suspense>
  );
}
