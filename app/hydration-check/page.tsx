"use client";

import { CandelCard } from "@/components/candel/CandelCard";
import type { CandelInstance } from "@/lib/candel/types";

const instance: CandelInstance = {
  id: "check-1",
  templateId: "market-analyst",
  userId: "u1",
  name: "market-analyst",
  displayName: "Apollo",
  description: "Scratch instance used to verify the Candel card markup.",
  status: "active",
  accountBindings: [],
  createdByAdmin: false,
  createdAt: 0,
  updatedAt: Date.now(),
};

export default function HydrationCheckPage() {
  return (
    <div className="p-8" id="hydration-check">
      <CandelCard
        instance={instance}
        templateName="Market analyst"
        onOpen={() => {}}
        onCustomize={() => {}}
        onSetStatus={() => {}}
        onArchive={() => {}}
        onDelete={() => {}}
      />
    </div>
  );
}
