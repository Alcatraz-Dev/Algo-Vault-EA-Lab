// Candel Workspace
"use client";

import AccountShell from "@/components/account/AccountShell";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface CandelInstanceResponse {
  success: boolean;
  instances: Array<{ id: string; name: string; role: string; status: string }>;
}

export default function CandelWorkspace() {
  const router = useRouter();
  const [candels, setCandels] = useState<CandelInstanceResponse["instances"]>([]);
  const [selectedCandel, setSelectedCandel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchCandels() {
    try {
      const res = await fetch("/api/candel/candel");
      if (!res.ok) {
        throw new Error(`Failed to load Candels: ${res.status}`);
      }
      const data: CandelInstanceResponse = await res.json();
      if (data.success) {
        setCandels(data.instances);
        if (data.instances.length > 0) {
          setSelectedCandel(data.instances[0].id);
        }
      }
    } catch (e) {
      console.error("Failed to load Candels", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      await fetchCandels();
    })();
  }, []);

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
      }
    } catch (e) {
      console.error("Failed to create Candel", e);
    }
  }

  if (loading) return (
    <AccountShell title="Candel" subtitle="Candel workspace" hideSidebar>
      <div className="text-muted-foreground">Loading...</div>
    </AccountShell>
  );

  return (
    <AccountShell title="Candel" subtitle="Candel workspace" hideSidebar>
      <div className="flex h-full flex-col">
        <div className="border-b border-border">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground">Candel Workspace</h1>
            <span className="text-muted-foreground text-sm">{candels.length} Candels</span>
          </div>
        </div>
        <div className="flex flex-1 gap-4 p-4 overflow-hidden">
          <div className="w-64 flex-shrink-0 border-r border-border overflow-y-auto">
            <div className="p-2">
              <input
                placeholder="Search Candels..."
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="p-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase">My Candels</h3>
              <div className="space-y-1">
                {candels.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCandel(c.id)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm ${
                      selectedCandel === c.id
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
            {selectedCandel ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold text-foreground">
                    {candels.find((c) => c.id === selectedCandel)?.name}
                  </h2>
                  <button
                    onClick={() => router.push(`/account/candels/[candelId]?candelId=${selectedCandel}`)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="2 2 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.336 9.336 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.184 12.184 0 0 1 8.624 21c-2.335 0-4.555-.645-6.374-1.766l-.001-.109a6.707 6.707 0 0 0 1.263-7.078 6.707 6.707 0 0 0-1.263 7.078l.001.109c-1.82.898-4.039 1.766-6.375 1.766C3.923 19.004 2 16.73 2 14.128 2 8.911 8.911 2 14.128 2a12.184 12.184 0 0 1 5.502 2.128m-.001 2.414c-.835.31-.695.958.139 1.409l.001.109a6.707 6.707 0 0 0 5.973 1.844 6.707 6.707 0 0 0 1.263-7.078l-.001-.109a6.707 6.707 0 0 0-1.263-7.078 6.707 6.707 0 0 0-5.973 1.844l-.002.109z" />
                    </svg>
                  </button>
                </div>
                <div className="p-4 rounded-md border border-border bg-muted/30">
                  <p className="text-sm text-muted-foreground">
                    Open a conversation to interact with this Candel. The Candel will use the existing AlgoVault agent engine.
                  </p>
                </div>
                <button
                  onClick={() => router.push(`/account/candels/conversation?candelId=${selectedCandel}`)}
                  className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90"
                >
                  Start Conversation
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <p className="text-lg font-medium">No Candel selected</p>
                <button
                  onClick={() => router.push("/account/candels/builder")}
                  className="mt-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
                >
                  Create a Candel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </AccountShell>
  );
}
