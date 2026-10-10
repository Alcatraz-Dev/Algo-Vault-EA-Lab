// Candel background jobs — scheduled work, per Candel
"use client";

import { Suspense } from "react";
import { LoadingState } from "@/components/ui/loading-state";
import { CandelScope } from "@/components/candel/CandelScope";
import { JobsPanel } from "@/components/candel/panels";

export default function CandelJobsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading background jobs" rows={3} />}>
      <CandelScope
        title="Background jobs"
        subtitle="Work your Candels run on a schedule"
        render={(candelId) => <JobsPanel candelId={candelId} />}
      />
    </Suspense>
  );
}
