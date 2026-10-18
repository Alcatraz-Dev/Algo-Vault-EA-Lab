import React, { useState, useEffect } from "react";
import { Trash2 } from "lucide-react";
import { getSettings, saveSettings, clearMarketCache } from "@/storage/storage";
import type { ExtensionSettings } from "@/types";
import type { ThemeMode } from "@/theme";
import { readStoredTheme, setTheme } from "@/theme";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Separator,
  Switch,
  cn,
} from "@/components/ui";

const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"];

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

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
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [saved, setSaved] = useState(false);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      setAccountSizeText(s.accountSize != null ? String(s.accountSize) : "10000");
    });
    readStoredTheme().then(setThemeMode);
  }, []);

  const update = (key: keyof ExtensionSettings, value: boolean | number | string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleThemeChange = (mode: ThemeMode) => {
    setThemeMode(mode);
    update("theme", mode === "system" ? "dark" : mode); // legacy mirror; avTheme is canonical
    setTheme(mode); // persist + apply immediately across the extension
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-8">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" className="h-[18px] w-[18px]">
              <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M14 7h7v7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              AlgoVault Extension
            </p>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Settings</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Configure your trading intelligence companion
            </p>
          </div>
        </div>

        {/* ── Cards ──────────────────────────────────────────────── */}
        <div className="mt-8 space-y-5">
          <Card className="rounded-xl border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Behavior</CardTitle>
              <CardDescription className="text-xs">
                Detection, overlay and confirmation behavior on TradingView.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ToggleRow
                label="Auto-detect TradingView"
                desc="Automatically detect symbols on TradingView"
                checked={settings.autoDetectTradingView}
                onChange={(v) => update("autoDetectTradingView", v)}
              />
              <Separator />
              <ToggleRow
                label="Show overlay on TradingView"
                desc="Floating AlgoVault intelligence panel"
                checked={settings.showOverlay}
                onChange={(v) => update("showOverlay", v)}
              />
              <Separator />
              <ToggleRow
                label="Enable chart analysis"
                desc="Allow AI chart analysis features"
                checked={settings.enableChartAnalysis}
                onChange={(v) => update("enableChartAnalysis", v)}
              />
              <Separator />
              <ToggleRow
                label="Confirm before execution"
                desc="Always show confirmation dialog"
                checked={settings.confirmBeforeExecution}
                onChange={(v) => update("confirmBeforeExecution", v)}
              />
            </CardContent>
          </Card>

          <Card className="rounded-xl border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Defaults</CardTitle>
              <CardDescription className="text-xs">
                Sizing and timeframe applied to new analyses.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4 py-2">
                <Label htmlFor="account-size" className="text-sm font-medium text-foreground">
                  Account Size ($)
                </Label>
                <Input
                  id="account-size"
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
                  className="h-8 w-36 rounded-lg bg-background tabular-nums"
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between gap-4 py-2">
                <Label htmlFor="default-risk" className="text-sm font-medium text-foreground">
                  Default Risk %
                </Label>
                <Input
                  id="default-risk"
                  type="number"
                  min={0.1}
                  max={10}
                  step={0.1}
                  value={settings.defaultRiskPercent}
                  onChange={(e) => update("defaultRiskPercent", parseFloat(e.target.value) || 1)}
                  className="h-8 w-24 rounded-lg bg-background tabular-nums"
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between gap-4 py-2">
                <Label htmlFor="default-timeframe" className="text-sm font-medium text-foreground">
                  Default Timeframe
                </Label>
                <select
                  id="default-timeframe"
                  value={settings.defaultTimeframe}
                  onChange={(e) => update("defaultTimeframe", e.target.value)}
                  className="h-8 w-36 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {TIMEFRAMES.map((tf) => (
                    <option key={tf} value={tf}>{tf}</option>
                  ))}
                </select>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-xl border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Appearance</CardTitle>
              <CardDescription className="text-xs">
                Choose how AlgoVault looks.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Theme</p>
                  <p className="text-xs text-muted-foreground">
                    Applies across the whole extension.
                  </p>
                </div>
                <div
                  role="group"
                  aria-label="Theme"
                  className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-background p-0.5"
                >
                  {THEME_OPTIONS.map((opt) => {
                    const active = themeMode === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => handleThemeChange(opt.value)}
                        className={cn(
                          "rounded-md px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active
                            ? "bg-secondary font-medium text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Actions ────────────────────────────────────────────── */}
        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="text-[11px] tabular-nums text-muted-foreground">
            AlgoVault Trading Intelligence v2.0.0
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClearCache}
              className="rounded-lg border-destructive/30 bg-transparent text-muted-foreground hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {cleared ? "Cache cleared" : "Clear market cache"}
            </Button>
            <Button type="button" variant="brand" size="sm" onClick={handleSave} className="rounded-lg">
              {saved ? "Saved!" : "Save Settings"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}
