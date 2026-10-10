// Candel tool calls — the tool audit trail, per Candel
"use client";

import { Suspense } from "react";
import { LoadingState } from "@/components/ui/loading-state";
import { CandelScope } from "@/components/candel/CandelScope";
import { ToolCallsPanel } from "@/components/candel/panels";

export default function CandelToolCallsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading tool calls" rows={3} />}>
      <CandelScope
        title="Tool calls"
        subtitle="Every tool your Candels invoked"
        render={(candelId) => <ToolCallsPanel candelId={candelId} />}
      />
    </Suspense>
  );
}
