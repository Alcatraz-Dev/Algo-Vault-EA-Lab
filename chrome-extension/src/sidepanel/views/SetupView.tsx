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
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-mute">Default persona</p>
        <div className="grid grid-cols-2 gap-1.5">
          {PERSONAS.map((p) => {
            const PIcon = p.Icon;
            return (
              <button
                key={p.id}
                onClick={() => update({ personaId: p.id })}
                className={`rounded-lg border px-2.5 py-2 text-left ${
                  prefs.personaId === p.id ? "border-brand-500/50 bg-brand-500/10" : "border-edge bg-card hover:border-brand-500/25"
                }`}
              >
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
                  <PIcon size={11} className={prefs.personaId === p.id ? "text-brand-400" : "text-ink-mute"} /> {p.name}
                </span>
                <span className="mt-0.5 block text-[9px] leading-snug text-ink-faint">{p.description}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <label className="flex items-center justify-between rounded-lg border border-edge bg-card px-2.5 py-2">
          <span>
            <span className="block text-[11px] font-medium text-ink">Auto-analyze on chart switch</span>
            <span className="text-[9px] text-ink-faint">Pre-generate the quick research note when the symbol changes</span>
          </span>
          <input
            type="checkbox"
            checked={prefs.autoAnalyzeOnSwitch}
            onChange={(e) => update({ autoAnalyzeOnSwitch: e.target.checked })}
            className="h-4 w-4 accent-[#ff4d00]"
          />
        </label>
      </section>

      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-mute">Connection</p>
        <div className="rounded-lg border border-edge bg-card px-2.5 py-2">
          <a
            href={`${getAlgoVaultUrl()}/alerts`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-brand-400 hover:text-brand-300"
          >
            Open Alert Center on the dashboard <ExternalLink size={9} />
          </a>
        </div>
      </section>

      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-mute">Data</p>
        <button
          onClick={wipeHistory}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-500/25 bg-rose-500/10 py-2 text-[11px] font-medium text-rose-300 hover:bg-rose-500/20"
        >
          <Trash2 size={12} /> {wiped ? "Cleared!" : "Clear copilot threads, memory & research cache"}
        </button>
        <p className="mt-1 text-[9px] text-ink-faint">All data lives in your browser (chrome.storage.local) — nothing is stored server-side.</p>
      </section>

      {saved && <p className="text-center text-[10px] text-emerald-400">Preferences saved</p>}
    </div>
  );
}
