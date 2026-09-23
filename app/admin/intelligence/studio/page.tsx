import { Suspense } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import AdminShell from "@/components/admin/AdminShell";
import StudioClient from "./studio-client";

export const metadata = {
  title: "Intelligence Studio",
  description: "Create, test, and deploy trading workflows",
};

export default function StudioPage() {
  return (
    <AdminShell title="Intelligence Studio" subtitle="Create, test, and deploy trading workflows">
      <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading Studio...</div>}>
        <ReactFlowProvider>
          <StudioClient />
        </ReactFlowProvider>
      </Suspense>
    </AdminShell>
  );
}