import React, { useState, useEffect } from "react";
import { Zap } from "lucide-react";
import { getSettings, saveSettings, clearMarketCache } from "@/storage/storage";
import type { ExtensionSettings } from "@/types";

export default function OptionsApp() {
  const [settings, setSettings] = useState<ExtensionSettings>({
    algovaultUrl: "",
    autoDetectTradingView: true,
    showOverlay: true,
    enableChartAnalysis: true,
    defaultRiskPercent: 1,
    defaultTimeframe: "H1",
    confirmBeforeExecution: true,
    theme: "dark",
  });
  const [accountSizeText, setAccountSizeText] = useState<string>("10000");
  const [saved, setSaved] = useState(false);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      setAccountSizeText(s.accountSize != null ? String(s.accountSize) : "10000");
    });
  }, []);

  const update = (key: keyof ExtensionSettings, value: boolean | number | string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    await saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClearCache = async () => {
    await clearMarketCache();
    setCleared(true);
    setTimeout(() => setCleared(false), 2000);
  };

  const inputCls =
    "w-full rounded-lg border border-edge bg-raised px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-brand-500/60";

  const Toggle = ({ label, desc, value, onChange }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void }) => (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="text-xs text-ink-mute">{desc}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${value ? "bg-brand-500" : "bg-neutral-700"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${value ? "translate-x-4" : "translate-x-0.5"}`}
        />
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-base p-6 text-ink">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500/15">
            <Zap size={16} className="text-brand-500" />
          </div>
          <div>
            <h1 className="text-lg font-bold">AlgoVault Extension Settings</h1>
            <p className="text-xs text-ink-mute">Configure your trading intelligence companion</p>
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-edge bg-card p-5">
          <div className="divide-y divide-edge border-t border-b border-edge">
            <Toggle label="Auto-detect TradingView" desc="Automatically detect symbols on TradingView" value={settings.autoDetectTradingView} onChange={(v) => update("autoDetectTradingView", v)} />
            <Toggle label="Show overlay on TradingView" desc="Floating AlgoVault intelligence panel" value={settings.showOverlay} onChange={(v) => update("showOverlay", v)} />
            <Toggle label="Enable chart analysis" desc="Allow AI chart analysis features" value={settings.enableChartAnalysis} onChange={(v) => update("enableChartAnalysis", v)} />
            <Toggle label="Confirm before execution" desc="Always show confirmation dialog" value={settings.confirmBeforeExecution} onChange={(v) => update("confirmBeforeExecution", v)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-mute">Account Size ($)</label>
              <input
                type="number"
                inputMode="decimal"
                min={1}
                step="any"
                value={accountSizeText}
                onChange={(e) => {
                  const raw = e.target.value;
                  setAccountSizeText(raw);
                  const value = parseFloat(raw);
                  if (Number.isFinite(value) && value >= 1) update("accountSize", value);
                }}
                onBlur={() => {
                  const value = parseFloat(accountSizeText);
                  if (!Number.isFinite(value) || value < 1) setAccountSizeText(String(settings.accountSize ?? 10000));
                }}
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-mute">Default Risk %</label>
              <input
                type="number"
                min={0.1}
                max={10}
                step={0.1}
                value={settings.defaultRiskPercent}
                onChange={(e) => update("defaultRiskPercent", parseFloat(e.target.value) || 1)}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-ink-mute">Default Timeframe</label>
            <select
              value={settings.defaultTimeframe}
              onChange={(e) => update("defaultTimeframe", e.target.value)}
              className={inputCls}
            >
              {["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"].map((tf) => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-400"
          >
            {saved ? "Saved!" : "Save Settings"}
          </button>
          <button
            type="button"
            onClick={handleClearCache}
            className="rounded-lg border border-edge bg-card px-4 py-2.5 text-sm text-ink-mute transition-colors hover:border-rose-500/30 hover:text-rose-400"
          >
            {cleared ? "Cache cleared" : "Clear market cache"}
          </button>
        </div>

        <p className="mt-4 text-center text-[10px] text-ink-faint">
          AlgoVault Trading Intelligence v2.0.0
        </p>
      </div>
    </div>
  );
}
