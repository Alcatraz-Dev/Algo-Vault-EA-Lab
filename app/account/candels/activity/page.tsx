// Candel activity — server-generated audit trail, per Candel
"use client";

import { Suspense } from "react";
import { LoadingState } from "@/components/ui/loading-state";
import { CandelScope } from "@/components/candel/CandelScope";
import { ActivityPanel } from "@/components/candel/panels";

export default function CandelActivityPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading activity" rows={3} />}>
      <CandelScope
        title="Activity"
        subtitle="Every action a Candel took, and when"
        render={(candelId) => <ActivityPanel candelId={candelId} />}
      />
    </Suspense>
  );
}
