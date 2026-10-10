// Candel automations — scheduled and event-driven prompts, per Candel
"use client";

import { Suspense } from "react";
import { LoadingState } from "@/components/ui/loading-state";
import { CandelScope } from "@/components/candel/CandelScope";
import { AutomationsPanel } from "@/components/candel/panels";

export default function CandelAutomationsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading automations" rows={3} />}>
      <CandelScope
        title="Automations"
        subtitle="Let a Candel work on a schedule or a trigger"
        render={(candelId) => <AutomationsPanel candelId={candelId} />}
      />
    </Suspense>
  );
}
