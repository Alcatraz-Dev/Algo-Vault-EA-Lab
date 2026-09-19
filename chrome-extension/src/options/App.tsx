import React, { useState, useEffect } from "react";
import { getSettings, saveSettings } from "@/storage/storage";
import { getAlgoVaultUrl } from "@/config/environment";
import type { ExtensionSettings } from "@/types";

export default function OptionsApp() {
  const [settings, setSettings] = useState<ExtensionSettings>({
    algovaultUrl: getAlgoVaultUrl(),
    autoDetectTradingView: true,
    showOverlay: true,
    enableChartAnalysis: true,
    defaultRiskPercent: 1,
    defaultTimeframe: "H1",
    confirmBeforeExecution: true,
    theme: "dark",
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  const handleSave = async () => {
    await saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const update = (key: keyof ExtensionSettings, value: boolean | number | string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#f0f0f5] p-6">
      <div className="max-w-lg mx-auto">
        <h1 className="text-xl font-bold mb-1">AlgoVault Extension Settings</h1>
        <p className="text-sm text-[#8888aa] mb-6">Configure your trading intelligence companion</p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#8888aa] mb-1">AlgoVault URL</label>
            <input
              type="url"
              value={settings.algovaultUrl}
              onChange={(e) => update("algovaultUrl", e.target.value)}
              className="w-full rounded-lg border border-[#2a2a3e] bg-[#1a1a2e] px-3 py-2 text-sm text-[#f0f0f5] focus:border-violet-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Auto-detect TradingView</p>
              <p className="text-xs text-[#8888aa]">Automatically detect symbols on TradingView</p>
            </div>
            <button
              type="button"
              onClick={() => update("autoDetectTradingView", !settings.autoDetectTradingView)}
              className={`relative h-5 w-9 rounded-full transition-colors ${settings.autoDetectTradingView ? "bg-violet-600" : "bg-[#2a2a3e]"}`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${settings.autoDetectTradingView ? "translate-x-4" : "translate-x-0.5"}`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Show overlay on TradingView</p>
              <p className="text-xs text-[#8888aa]">Floating AlgoVault button</p>
            </div>
            <button
              type="button"
              onClick={() => update("showOverlay", !settings.showOverlay)}
              className={`relative h-5 w-9 rounded-full transition-colors ${settings.showOverlay ? "bg-violet-600" : "bg-[#2a2a3e]"}`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${settings.showOverlay ? "translate-x-4" : "translate-x-0.5"}`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enable chart analysis</p>
              <p className="text-xs text-[#8888aa]">Allow AI chart analysis features</p>
            </div>
            <button
              type="button"
              onClick={() => update("enableChartAnalysis", !settings.enableChartAnalysis)}
              className={`relative h-5 w-9 rounded-full transition-colors ${settings.enableChartAnalysis ? "bg-violet-600" : "bg-[#2a2a3e]"}`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${settings.enableChartAnalysis ? "translate-x-4" : "translate-x-0.5"}`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Confirm before execution</p>
              <p className="text-xs text-[#8888aa]">Always show confirmation dialog</p>
            </div>
            <button
              type="button"
              onClick={() => update("confirmBeforeExecution", !settings.confirmBeforeExecution)}
              className={`relative h-5 w-9 rounded-full transition-colors ${settings.confirmBeforeExecution ? "bg-violet-600" : "bg-[#2a2a3e]"}`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${settings.confirmBeforeExecution ? "translate-x-4" : "translate-x-0.5"}`}
              />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#8888aa] mb-1">Default Risk %</label>
              <input
                type="number"
                min={0.1}
                max={10}
                step={0.1}
                value={settings.defaultRiskPercent}
                onChange={(e) => update("defaultRiskPercent", parseFloat(e.target.value) || 1)}
                className="w-full rounded-lg border border-[#2a2a3e] bg-[#1a1a2e] px-3 py-2 text-sm text-[#f0f0f5] focus:border-violet-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#8888aa] mb-1">Default Timeframe</label>
              <select
                value={settings.defaultTimeframe}
                onChange={(e) => update("defaultTimeframe", e.target.value)}
                className="w-full rounded-lg border border-[#2a2a3e] bg-[#1a1a2e] px-3 py-2 text-sm text-[#f0f0f5] focus:border-violet-500 focus:outline-none"
              >
                {["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"].map((tf) => (
                  <option key={tf} value={tf}>{tf}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 transition"
          >
            {saved ? "Saved!" : "Save Settings"}
          </button>
        </div>

        <p className="mt-4 text-center text-[10px] text-[#8888aa]">
          AlgoVault Trading Intelligence v1.0.0
        </p>
      </div>
    </div>
  );
}
