// Candel index — Candel workspace selector / home
"use client";

import AccountShell from "@/components/account/AccountShell";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function CandelIndex() {
  const router = useRouter();
  const [candels, setCandels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCandels();
  }, []);

  async function fetchCandels() {
    try {
      const res = await fetch("/api/candel/candel");
      const data: { success: boolean; instances: any[] } = await res.json();
      if (data.success) {
        setCandels(data.instances);
      }
    } catch (e) {
      console.error("Failed to load Candels", e);
    } finally {
      setLoading(false);
    }
  }

  async function createCandel(name: string, templateId: string) {
    try {
      const res = await fetch("/api/candel/candel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, templateId }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchCandels();
        router.push(`/account/candels/workspace?candelId=${data.instance.id}`);
      } else {
        alert(data.error || "Failed to create Candel");
      }
    } catch (e) {
      console.error("Failed to create Candel", e);
      alert("Failed to create Candel");
    }
  }

  if (loading) {
    return (
      <AccountShell title="Candels" subtitle="Candel workspace" hideSidebar>
        <div className="text-muted-foreground">Loading...</div>
      </AccountShell>
    );
  }

  return (
    <AccountShell title="Candels" subtitle="AI workspace" hideSidebar>
      <div className="flex h-full flex-col">
        <div className="border-b border-border">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground">Candels</h1>
            <span className="text-muted-foreground text-sm">
              {candels.length} Candel{candels.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <div className="flex flex-1 gap-4 p-4 overflow-hidden">
          <div className="w-64 flex-shrink-0 border-r border-border overflow-y-auto">
            <div className="p-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase">
                My Candels
              </h3>
              <div className="space-y-1">
                {candels.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => router.push(`/account/candels/workspace?candelId=${c.id}`)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm ${
                      c.id === candels[0]?.id
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/10"
                    }`}
                  >
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.role} · {c.status}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {candels.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-12">
                <p className="text-lg font-medium text-foreground">No Candels yet</p>
                <p className="text-sm text-muted-foreground">
                  Create your first Candel to get started.
                </p>
                <button
                  onClick={() => {
                    const templateId = prompt("Template ID (e.g. market-analyst):") || "market-analyst";
                    const name = prompt("Candel name:") || "My Candel";
                    if (templateId && name) createCandel(name, templateId);
                  }}
                  className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90"
                >
                  Create Candel
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {candels.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => router.push(`/account/candels/workspace?candelId=${c.id}`)}
                    className="w-full rounded-md border border-border px-4 py-3 text-left hover:bg-accent/10 transition"
                  >
                    <div className="font-medium">{c.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {c.role} · {c.status}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </AccountShell>
  );
}
