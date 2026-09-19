import React, { useState, useEffect } from "react";
import { getSettings, saveSettings } from "@/storage/storage";
import { getAlgoVaultUrl, isDevelopment } from "@/config/environment";
import { fetchDiagnostics } from "@/api/context";
import { buildMarketContext } from "@/services/market-service";
import type { ExtensionSettings } from "@/types";
import type { DebugInfo, AnalysisStage } from "@/types/market-context";

interface SettingsViewProps {
  onBack: () => void;
  onLogout: () => void;
}

export function SettingsView({ onBack, onLogout }: SettingsViewProps) {
  const [settings, setSettings] = useState<ExtensionSettings>({
    algovaultUrl: getAlgoVaultUrl(), autoDetectTradingView: true, showOverlay: true,
    enableChartAnalysis: true, defaultRiskPercent: 1, defaultTimeframe: "H1",
    confirmBeforeExecution: true, theme: "dark",
  });
  const [saved, setSaved] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [devDiagnostic, setDevDiagnostic] = useState(false);

  useEffect(() => { getSettings().then((s) => setSettings(s)); }, []);

  const handleSave = async () => {
    await saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const update = <K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleRefreshDebug = async () => {
    setDebugLoading(true);
    try {
      const info = await fetchDiagnostics();
      setDebugInfo(info);
    } catch {
      setDebugInfo(null);
    } finally {
      setDebugLoading(false);
    }
  };

  const inputClass = "w-full bg-white/5 border border-white/10 rounded px-2.5 py-1.5 text-xs text-[#f0f0f5] outline-none focus:border-violet-500/30";

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
        <span className="text-xs font-medium text-[#f0f0f5]">Settings</span>
        <div className="flex items-center gap-2">
          {isDevelopment() && (
            <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[9px] font-semibold uppercase tracking-wider">DEV</span>
          )}
          <button
            onClick={() => setDevDiagnostic(!devDiagnostic)}
            className="text-[9px] text-[#8888aa] hover:text-[#f0f0f5] transition-colors px-1.5 py-0.5 rounded border border-white/5"
          >
            Diag
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div>
          <label className="text-[10px] text-[#8888aa] uppercase tracking-wider mb-1 block">AlgoVault URL</label>
          <input type="url" value={settings.algovaultUrl} onChange={(e) => update("algovaultUrl", e.target.value)} className={inputClass} />
        </div>

        <div className="space-y-2">
          <ToggleRow label="Auto-detect TradingView" checked={settings.autoDetectTradingView} onChange={(v) => update("autoDetectTradingView", v)} />
          <ToggleRow label="Show overlay" checked={settings.showOverlay} onChange={(v) => update("showOverlay", v)} />
          <ToggleRow label="Enable chart analysis" checked={settings.enableChartAnalysis} onChange={(v) => update("enableChartAnalysis", v)} />
          <ToggleRow label="Confirm before execution" checked={settings.confirmBeforeExecution} onChange={(v) => update("confirmBeforeExecution", v)} />
        </div>

        <div>
          <label className="text-[10px] text-[#8888aa] uppercase tracking-wider mb-1 block">Default Risk %</label>
          <input type="number" value={settings.defaultRiskPercent} onChange={(e) => update("defaultRiskPercent", parseFloat(e.target.value) || 1)} className={inputClass} />
        </div>

        <div>
          <label className="text-[10px] text-[#8888aa] uppercase tracking-wider mb-1 block">Default Timeframe</label>
          <select value={settings.defaultTimeframe} onChange={(e) => update("defaultTimeframe", e.target.value)} className={inputClass}>
            {["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"].map((tf) => (
              <option key={tf} value={tf}>{tf}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] text-[#8888aa] uppercase tracking-wider mb-1 block">Theme</label>
          <select value={settings.theme} onChange={(e) => update("theme", e.target.value as "dark" | "light")} className={inputClass}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>

        <button onClick={handleSave} className="w-full py-2 rounded-lg bg-violet-500/20 text-violet-400 text-xs font-medium hover:bg-violet-500/30 transition-all">
          {saved ? "Saved ✓" : "Save Settings"}
        </button>

        {devDiagnostic && isDevelopment() && (
          <div className="space-y-2 border-t border-white/5 pt-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-[#8888aa] uppercase tracking-wider">Diagnostics</span>
              <button onClick={handleRefreshDebug} disabled={debugLoading} className="text-[10px] text-violet-400 hover:text-violet-300">
                {debugLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            {debugInfo && (
              <div className="space-y-1.5 text-[10px] font-mono bg-white/[0.02] border border-white/5 rounded-lg p-2.5">
                <div className="text-[#8888aa]">Symbol: {debugInfo.symbolDetected || "null"}</div>
                <div className="text-[#8888aa]">Timeframe: {debugInfo.timeframeDetected || "null"}</div>
                <div className="text-[#8888aa]">Market API: {debugInfo.marketApi}</div>
                <div className="text-[#8888aa]">Market API Status: {debugInfo.marketApiStatus ?? "?"}</div>
                <div className="text-[#8888aa]">Candle Count: {debugInfo.candleCount}</div>
                <div className="text-[#8888aa]">Timeframes: {debugInfo.timeframesAvailable.join(", ")}</div>
                <div className="text-[#8888aa]">Analytics: {debugInfo.analyticsStatus}</div>
                <div className="text-[#8888aa]">AI Status: {debugInfo.aiStatus}</div>
                <div className="text-[#8888aa]">Latency: {debugInfo.requestLatency ?? "?"}ms</div>
                <div className="text-[#8888aa]">Errors: {debugInfo.errors.length}</div>
                {debugInfo.errors.map((e: string, i: number) => (
                  <div key={i} className="text-rose-400">{e}</div>
                ))}
                {debugInfo.stages.length > 0 && (
                  <div className="mt-1 space-y-0.5 border-t border-white/5 pt-1">
                    {debugInfo.stages.map((s: AnalysisStage, i: number) => (
                      <div key={i} className="text-[9px]">
                        <span className={s.status === "complete" ? "text-emerald-400" : s.status === "error" ? "text-rose-400" : s.status === "running" ? "text-violet-400" : "text-[#8888aa]"}>
                          {s.status === "running" ? "⏳" : s.status === "complete" ? "✓" : s.status === "error" ? "✗" : "○"}
                        </span>{" "}{s.name}: {s.message}
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

      <div className="px-3 py-2 border-t border-white/5 space-y-2">
        <button onClick={onLogout} className="w-full py-2 rounded-lg bg-rose-500/10 text-rose-400 text-xs font-medium hover:bg-rose-500/20 border border-rose-500/20 transition-all">Logout</button>
        <button onClick={onBack} className="w-full text-xs text-[#8888aa] hover:text-[#f0f0f5] transition-colors py-1">Back</button>
      </div>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[11px] text-[#8888aa]">{label}</span>
      <button onClick={() => onChange(!checked)}
        className={`relative w-8 h-4 rounded-full transition-colors ${checked ? "bg-violet-500" : "bg-white/10"}`}>
        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}
