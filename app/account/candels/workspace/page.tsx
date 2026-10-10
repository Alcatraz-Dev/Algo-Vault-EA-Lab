// Candel workspace — notes and research pages owned by one Candel
"use client";

import { Suspense } from "react";
import { LoadingState } from "@/components/ui/loading-state";
import { CandelScope } from "@/components/candel/CandelScope";
import { WorkspacePanel } from "@/components/candel/panels";

export default function CandelWorkspacePage() {
  return (
    <Suspense fallback={<LoadingState label="Loading workspace" rows={3} />}>
      <CandelScope
        title="Workspace"
        subtitle="Notes and research your Candel keeps"
        render={(candelId) => <WorkspacePanel candelId={candelId} />}
      />
    </Suspense>
  );
}
