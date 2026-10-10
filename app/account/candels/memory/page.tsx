// Candel memory — remembered preferences and facts, per Candel
"use client";

import { Suspense } from "react";
import { LoadingState } from "@/components/ui/loading-state";
import { CandelScope } from "@/components/candel/CandelScope";
import { MemoryPanel } from "@/components/candel/panels";

export default function CandelMemoryPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading memory" rows={3} />}>
      <CandelScope
        title="Memory"
        subtitle="What your Candels remember"
        render={(candelId) => <MemoryPanel candelId={candelId} />}
      />
    </Suspense>
  );
}
