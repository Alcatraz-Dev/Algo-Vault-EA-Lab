/**
 * Setup view — copilot preferences, connection status and shortcuts.
 */
import React, { useState, useEffect } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import { getCopilotPrefs, saveCopilotPrefs, getCopilotThreads, saveCopilotThreads, getResearchCache, setResearchCache, getCopilotMemory, saveCopilotMemory } from "@/storage/storage";
import { PERSONAS, type CopilotPreferences } from "@/types/copilot";
import { getAlgoVaultUrl } from "@/config/environment";

export function SetupView() {
  const [prefs, setPrefs] = useState<CopilotPreferences | null>(null);
  const [saved, setSaved] = useState(false);
  const [wiped, setWiped] = useState(false);

  useEffect(() => {
    getCopilotPrefs().then(setPrefs);
  }, []);

  if (!prefs) return null;

  const update = (patch: Partial<CopilotPreferences>) => {
    setPrefs((prev) => (prev ? { ...prev, ...patch } : prev));
    saveCopilotPrefs(patch);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const wipeHistory = async () => {
    await saveCopilotThreads([]);
    await saveCopilotMemory({});
    await setResearchCache({});
    setWiped(true);
    setTimeout(() => setWiped(false), 2500);
  };

  return (
    <div className="h-full overflow-y-auto p-3 space-y-4">
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Default persona</p>
        <div className="grid grid-cols-2 gap-1.5">
          {PERSONAS.map((p) => {
            const PIcon = p.Icon;
            return (
              <button
                key={p.id}
                onClick={() => update({ personaId: p.id })}
                className={`rounded-lg border px-2.5 py-2 text-left ${
                  prefs.personaId === p.id ? "border-brand/50 bg-brand/10" : "border-border bg-card hover:border-muted-foreground/40"
                }`}
              >
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                  <PIcon size={11} className={prefs.personaId === p.id ? "text-brand" : "text-muted-foreground"} /> {p.name}
                </span>
                <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">{p.description}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <label className="flex items-center justify-between rounded-xl border border-border bg-card px-2.5 py-2">
          <span>
            <span className="block text-[11px] font-medium text-foreground">Auto-analyze on chart switch</span>
            <span className="text-[10px] text-muted-foreground">Pre-generate the quick research note when the symbol changes</span>
          </span>
          <input
            type="checkbox"
            checked={prefs.autoAnalyzeOnSwitch}
            onChange={(e) => update({ autoAnalyzeOnSwitch: e.target.checked })}
            className="h-4 w-4 accent-primary"
          />
        </label>
      </section>

      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Connection</p>
        <div className="rounded-xl border border-border bg-card px-2.5 py-2">
          <a
            href={`${getAlgoVaultUrl()}/alerts`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-brand hover:text-brand"
          >
            Open Alert Center on the dashboard <ExternalLink size={9} />
          </a>
        </div>
      </section>

      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Data</p>
        <button
          onClick={wipeHistory}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-negative/25 bg-negative/10 py-2 text-[11px] font-medium text-negative hover:bg-negative/20"
        >
          <Trash2 size={12} /> {wiped ? "Cleared!" : "Clear copilot threads, memory & research cache"}
        </button>
        <p className="mt-1 text-[10px] text-muted-foreground">All data lives in your browser (chrome.storage.local) — nothing is stored server-side.</p>
      </section>

      {saved && <p className="text-center text-[10px] text-positive">Preferences saved</p>}
    </div>
  );
}
