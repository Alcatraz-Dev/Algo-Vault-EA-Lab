import React, { useState, useEffect } from "react";
import { Loader2, Trash2, Bot } from "lucide-react";
import { getSettings, saveSettings, clearMarketCache, getCopilotPrefs, saveCopilotPrefs } from "@/storage/storage";
import { fetchDiagnostics } from "@/api/context";
import type { ExtensionSettings } from "@/types";
import type { DebugInfo, AnalysisStage } from "@/types/market-context";
import { PERSONAS, type PersonaId } from "@/types/copilot";
import { openSidePanelFromExtensionPage, primeSidePanelWindowId } from "@/utils/side-panel";
import type { ThemeMode } from "@/theme";
import { setTheme } from "@/theme";
import { Field, Feedback, GhostButton, inputClass, PrimaryButton, ViewHeader } from "./ui";

interface SettingsViewProps {
  onBack: () => void;
  onLogout: () => void;
  /** Navigate to the in-extension Copilot tab. */
  onOpenCopilot?: () => void;
}

export function SettingsView({ onBack, onLogout, onOpenCopilot }: SettingsViewProps) {
  const [settings, setSettings] = useState<ExtensionSettings>({
    algovaultUrl: "", autoDetectTradingView: true, showOverlay: true,
    enableChartAnalysis: true, defaultRiskPercent: 1, defaultTimeframe: "H1",
    confirmBeforeExecution: true, theme: "dark",
  });
  const [accountSizeText, setAccountSizeText] = useState<string>("10000");
  const [saved, setSaved] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [devDiagnostic, setDevDiagnostic] = useState(false);
  const [copilotPersona, setCopilotPersona] = useState<PersonaId>("analyst");
  const [copilotAuto, setCopilotAuto] = useState(false);

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      setAccountSizeText(s.accountSize != null ? String(s.accountSize) : "10000");
    });
    getCopilotPrefs().then((p) => {
      setCopilotPersona(p.personaId);
      setCopilotAuto(p.autoAnalyzeOnSwitch);
    });
    primeSidePanelWindowId();
  }, []);

  const update = <K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  /**
   * Account size as TEXT so the field keeps exactly what the user types
   * (typing "500" no longer collapses to "1", trailing decimals aren't
   * eaten mid-edit). It is parsed — and persisted — only when valid.
   */
  const handleAccountSizeChange = (raw: string) => {
    setAccountSizeText(raw);
    const trimmed = raw.trim();
    if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return; // allow "5", "5.", "5.5" while typing
    const value = parseFloat(trimmed);
    if (Number.isFinite(value) && value >= 1) {
      update("accountSize", value);
    }
  };

  const handleThemeChange = (mode: ThemeMode) => {
    update("theme", mode);
    setTheme(mode); // live-switch the whole popup, persisted for next open
  };

  const handleSave = async () => {
    await saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClearCache = async () => {
    await clearMarketCache();
    setCacheCleared(true);
    setTimeout(() => setCacheCleared(false), 2500);
  };

  const handleRefreshDebug = async () => {
    setDebugLoading(true);
    try {
      setDebugInfo(await fetchDiagnostics());
    } catch {
      setDebugInfo(null);
    } finally {
      setDebugLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <ViewHeader title="Settings" />

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Account size ($)" hint="Used for risk sizing.">
            <input
              type="number"
              inputMode="decimal"
              min={1}
              step="any"
              value={accountSizeText}
              onChange={(e) => handleAccountSizeChange(e.target.value)}
              onBlur={() => {
                // Normalize on leave: restore last valid value if empty/invalid.
                const value = parseFloat(accountSizeText);
                if (!Number.isFinite(value) || value < 1) setAccountSizeText(String(settings.accountSize ?? 10000));
              }}
              className={inputClass}
            />
          </Field>
          <Field label="Default risk (%)">
            <input
              type="number"
              step="0.1"
              value={settings.defaultRiskPercent}
              onChange={(e) => update("defaultRiskPercent", parseFloat(e.target.value) || 1)}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Default timeframe">
            <select value={settings.defaultTimeframe} onChange={(e) => update("defaultTimeframe", e.target.value)} className={inputClass}>
              {["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"].map((tf) => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </select>
          </Field>
          <Field label="Theme">
            <select value={settings.theme} onChange={(e) => handleThemeChange(e.target.value as ThemeMode)} className={inputClass}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </Field>
        </div>

        <div className="space-y-1.5 rounded-lg border border-edge bg-card p-2.5">
          <ToggleRow label="Auto-detect TradingView" checked={settings.autoDetectTradingView} onChange={(v) => update("autoDetectTradingView", v)} />
          <ToggleRow label="Show overlay on TradingView" checked={settings.showOverlay} onChange={(v) => update("showOverlay", v)} />
          <ToggleRow label="Enable chart analysis" checked={settings.enableChartAnalysis} onChange={(v) => update("enableChartAnalysis", v)} />
          <ToggleRow label="Confirm before execution" checked={settings.confirmBeforeExecution} onChange={(v) => update("confirmBeforeExecution", v)} />
        </div>

        {/* ── AI Copilot (v3) ─────────────────────────────────────── */}
        <div className="space-y-2 rounded-lg border border-brand-500/20 bg-brand-500/[0.04] p-2.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-brand-400">
              <Bot size={11} /> AI Copilot
            </span>
            <button
              onClick={() => (onOpenCopilot ? onOpenCopilot() : openSidePanelFromExtensionPage())}
              className="text-[10px] text-brand-400 hover:text-brand-300"
            >
              Open →
            </button>
          </div>
          <p className="text-[9px] leading-relaxed text-ink-faint">
            The copilot remembers each symbol separately, can draw key levels on your chart, and manages alerts.
          </p>
          <Field label="Persona">
            <select
              value={copilotPersona}
              onChange={(e) => { setCopilotPersona(e.target.value as PersonaId); saveCopilotPrefs({ personaId: e.target.value as PersonaId }); }}
              className={inputClass}
            >
              {PERSONAS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
          <ToggleRow
            label="Auto-analyze on chart switch"
            checked={copilotAuto}
            onChange={(v) => { setCopilotAuto(v); saveCopilotPrefs({ autoAnalyzeOnSwitch: v }); }}
          />
        </div>

        <div className="flex gap-2">
          <PrimaryButton onClick={handleSave} className="flex-1">{saved ? "Saved ✓" : "Save Settings"}</PrimaryButton>
          <button
            onClick={handleClearCache}
            title="Clear cached market data"
            className="flex items-center justify-center gap-1.5 rounded-lg border border-edge bg-card px-3 text-[11px] text-ink-mute transition-colors hover:border-rose-500/30 hover:text-rose-400"
          >
            {cacheCleared ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            {cacheCleared ? "Cleared" : "Cache"}
          </button>
        </div>

        {devDiagnostic && (
          <div className="space-y-2 border-t border-edge pt-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-mute">Diagnostics</span>
              <button onClick={handleRefreshDebug} disabled={debugLoading} className="text-[10px] text-brand-400 hover:text-brand-300">
                {debugLoading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            {debugInfo && (
              <div className="space-y-1 rounded-lg border border-edge bg-base p-2.5 font-mono text-[10px]">
                <div className="text-ink-mute">Symbol: {debugInfo.symbolDetected || "null"}</div>
                <div className="text-ink-mute">Timeframe: {debugInfo.timeframeDetected || "null"}</div>
                <div className="text-ink-mute">Market API: {debugInfo.marketApi} ({debugInfo.marketApiStatus ?? "?"})</div>
                <div className="text-ink-mute">Candles: {debugInfo.candleCount} · TFs: {debugInfo.timeframesAvailable.join(", ")}</div>
                <div className="text-ink-mute">Latency: {debugInfo.requestLatency ?? "?"}ms · Errors: {debugInfo.errors.length}</div>
                {debugInfo.errors.map((e: string, i: number) => (
                  <div key={i} className="text-rose-400">{e}</div>
                ))}
                {debugInfo.stages.length > 0 && (
                  <div className="mt-1 space-y-0.5 border-t border-edge pt-1">
                    {debugInfo.stages.map((s: AnalysisStage, i: number) => (
                      <div key={i} className="text-[9px]">
                        <span className={s.status === "complete" ? "text-emerald-400" : s.status === "error" ? "text-rose-400" : s.status === "running" ? "text-brand-400" : "text-ink-faint"}>
                          {s.status === "running" ? "⏳" : s.status === "complete" ? "✓" : s.status === "error" ? "✗" : "○"}
                        </span>{" "}
                        {s.name}: {s.message}
                        {s.duration ? ` (${s.duration}ms)` : ""}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-edge px-3 py-2">
        <button
          onClick={() => setDevDiagnostic(!devDiagnostic)}
          className="w-full rounded border border-edge px-1.5 py-1 text-[9px] text-ink-faint transition-colors hover:text-ink-mute"
        >
          {devDiagnostic ? "Hide diagnostics" : "Diagnostics"}
        </button>
        <button
          onClick={onLogout}
          className="w-full rounded-lg border border-rose-500/20 bg-rose-500/10 py-2 text-xs font-medium text-rose-400 transition-colors hover:bg-rose-500/20"
        >
          Logout
        </button>
      </div>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[11px] text-ink-mute">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`relative h-4 w-8 rounded-full transition-colors ${checked ? "bg-brand-500" : "bg-neutral-700"}`}
      >
        <div className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}
