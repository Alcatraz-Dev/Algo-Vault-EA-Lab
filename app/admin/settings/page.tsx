"use client";

import { useEffect, useRef, useState } from "react";
import {
    RefreshCw,
    Save,
    CreditCard,
    Globe,
    Lock,
    Palette,
    Upload,
    X,
} from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import { onValue, ref, update } from "firebase/database";
import { auth, database } from "@/lib/firebase";
import AdminShell from "@/components/admin/AdminShell";

type SiteSettings = {
    siteName?: string;
    siteTagline?: string;
    siteLogo?: string;
    supportEmail?: string;
    allowRegistrations?: boolean;
    requireEmailVerification?: boolean;
    maintenanceMode?: boolean;
    stripeEnabled?: boolean;
    signalsEnabled?: boolean;
    copyTradingEnabled?: boolean;
    donationsEnabled?: boolean;
    commissionRate?: number;
    minWithdrawal?: number;
};

export default function AdminSettingsPage() {
    const [settings, setSettings] = useState<SiteSettings>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        return onAuthStateChanged(auth, (user) => {
            if (!user) { setLoading(false); return; }
            return onValue(ref(database, "settings"), (snap) => {
                setSettings(snap.val() || {});
                setLoading(false);
            });
        });
    }, []);

    async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 2 * 1024 * 1024) {
            alert("Logo must be smaller than 2 MB.");
            return;
        }

        const allowed = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
        if (!allowed.includes(file.type)) {
            alert("Use PNG, JPG, WEBP or SVG.");
            return;
        }

        setUploading(true);
        try {
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result as string;
                set("siteLogo", dataUrl);
                setUploading(false);
            };
            reader.onerror = () => setUploading(false);
            reader.readAsDataURL(file);
        } catch {
            setUploading(false);
        }
    }

    function removeLogo() {
        set("siteLogo", "");
    }

    async function save() {
        setSaving(true);
        try {
            await update(ref(database, "settings"), {
                ...settings,
                updatedAt: Date.now(),
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } finally { setSaving(false); }
    }

    function set<K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) {
        setSettings(prev => ({ ...prev, [key]: value }));
    }

    return (
        <AdminShell title="Settings" subtitle="Platform configuration, feature toggles and payments.">
            <div className="mb-6 flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                    Changes are saved to the live site configuration and applied
                    immediately across the platform.
                </p>
                <button
                    onClick={save}
                    disabled={saving}
                    className="flex shrink-0 items-center gap-2 rounded-xl bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition hover:opacity-90 disabled:opacity-50"
                >
                    {saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
                    {saved ? "Saved!" : "Save Changes"}
                </button>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <RefreshCw className="h-7 w-7 animate-spin text-muted-foreground" />
                </div>
            ) : (
                <div className="space-y-8 max-w-3xl">

                            {/* Site */}
                            <Section icon={<Globe size={17} />} title="Site Configuration">
                                <Field label="Website Logo">
                                    <div className="flex items-center gap-4">
                                        {settings.siteLogo ? (
                                            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-border bg-muted">
                                                <img
                                                    src={settings.siteLogo}
                                                    alt="Site logo"
                                                    className="h-full w-full object-contain"
                                                />
                                                <button
                                                    onClick={removeLogo}
                                                    className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white"
                                                    aria-label="Remove logo"
                                                >
                                                    <X size={10} />
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-dashed border-border bg-muted text-muted-foreground">
                                                <Upload size={20} />
                                            </div>
                                        )}
                                        <div>
                                            <input
                                                ref={fileInputRef}
                                                type="file"
                                                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                                                onChange={handleLogoUpload}
                                                className="hidden"
                                            />
                                            <button
                                                onClick={() => fileInputRef.current?.click()}
                                                disabled={uploading}
                                                className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted/70 disabled:opacity-50"
                                            >
                                                {uploading ? <RefreshCw size={13} className="animate-spin" /> : <Upload size={13} />}
                                                {settings.siteLogo ? "Change logo" : "Upload logo"}
                                            </button>
                                            <p className="mt-1 text-[11px] text-muted-foreground">PNG, JPG, WEBP or SVG. Max 2 MB.</p>
                                        </div>
                                    </div>
                                </Field>
                                <Field label="Site Name">
                                    <input
                                        type="text"
                                        value={settings.siteName || ""}
                                        onChange={e => set("siteName", e.target.value)}
                                        placeholder="AlgoVault"
                                        className="w-full rounded-xl border border-border bg-muted px-3.5 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-ring"
                                    />
                                </Field>
                                <Field label="Tagline">
                                    <input
                                        type="text"
                                        value={settings.siteTagline || ""}
                                        onChange={e => set("siteTagline", e.target.value)}
                                        placeholder="Automated trading tools for serious traders"
                                        className="w-full rounded-xl border border-border bg-muted px-3.5 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-ring"
                                    />
                                </Field>
                                <Field label="Support Email">
                                    <input
                                        type="email"
                                        value={settings.supportEmail || ""}
                                        onChange={e => set("supportEmail", e.target.value)}
                                        placeholder="support@algovault.io"
                                        suppressHydrationWarning
                                        className="w-full rounded-xl border border-border bg-muted px-3.5 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-ring"
                                    />
                                </Field>
                            </Section>

                            {/* Features */}
                            <Section icon={<Palette size={17} />} title="Feature Toggles">
                                <ToggleField
                                    label="Allow New Registrations"
                                    desc="Let new users sign up"
                                    value={settings.allowRegistrations !== false}
                                    onChange={v => set("allowRegistrations", v)}
                                />
                                <ToggleField
                                    label="Maintenance Mode"
                                    desc="Show a maintenance page to all non-admin visitors"
                                    value={!!settings.maintenanceMode}
                                    onChange={v => set("maintenanceMode", v)}
                                    danger
                                />
                                <ToggleField
                                    label="AI Signals"
                                    desc="Enable the AI signals feature for users"
                                    value={settings.signalsEnabled !== false}
                                    onChange={v => set("signalsEnabled", v)}
                                />
                                <ToggleField
                                    label="Copy Trading"
                                    desc="Enable copy trading for users"
                                    value={settings.copyTradingEnabled !== false}
                                    onChange={v => set("copyTradingEnabled", v)}
                                />
                                <ToggleField
                                    label="Donations"
                                    desc="Enable the donate page and free resource grants"
                                    value={settings.donationsEnabled !== false}
                                    onChange={v => set("donationsEnabled", v)}
                                />
                            </Section>

                            {/* Payments */}
                            <Section icon={<CreditCard size={17} />} title="Payments & Affiliates">
                                <ToggleField
                                    label="Stripe Payments"
                                    desc="Enable Stripe checkout for product purchases"
                                    value={settings.stripeEnabled !== false}
                                    onChange={v => set("stripeEnabled", v)}
                                />
                                <Field label="Affiliate Commission Rate (%)">
                                    <input
                                        type="number"
                                        min="0"
                                        max="100"
                                        step="0.1"
                                        value={settings.commissionRate ?? 20}
                                        onChange={e => set("commissionRate", Number(e.target.value))}
                                        className="w-32 rounded-xl border border-border bg-muted px-3.5 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-ring"
                                    />
                                </Field>
                                <Field label="Min Withdrawal (USD)">
                                    <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={settings.minWithdrawal ?? 50}
                                        onChange={e => set("minWithdrawal", Number(e.target.value))}
                                        className="w-32 rounded-xl border border-border bg-muted px-3.5 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-ring"
                                    />
                                </Field>
                            </Section>

                            {/* Security */}
                            <Section icon={<Lock size={17} />} title="Security">
                                <ToggleField
                                    label="Require Email Verification"
                                    desc="Users must verify email before accessing premium features"
                                    value={!!settings.requireEmailVerification}
                                    onChange={v => set("requireEmailVerification", v)}
                                />
                            </Section>

                            <button
                                onClick={save}
                                disabled={saving}
                                className="flex items-center gap-2 rounded-xl bg-foreground px-6 py-3 font-semibold text-background transition hover:opacity-90 disabled:opacity-50"
                            >
                                {saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
                                {saved ? "✓ Saved!" : "Save All Settings"}
                            </button>
                        </div>
                    )}
        </AdminShell>
    );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-2xl border border-border bg-muted/30 p-6">
            <div className="flex items-center gap-2 mb-5 pb-4 border-b border-border">
                <span className="text-muted-foreground">{icon}</span>
                <h2 className="font-semibold text-foreground">{title}</h2>
            </div>
            <div className="space-y-5">{children}</div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">{label}</label>
            {children}
        </div>
    );
}

function ToggleField({ label, desc, value, onChange, danger }: { label: string; desc?: string; value: boolean; onChange: (v: boolean) => void; danger?: boolean }) {
    return (
        <div className="flex items-center justify-between gap-4">
            <div>
                <p className={`text-sm font-medium ${danger && value ? "text-red-500" : "text-foreground"}`}>{label}</p>
                {desc && <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>}
            </div>
            <button
                type="button"
                onClick={() => onChange(!value)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition ${value ? (danger ? "bg-red-500" : "bg-violet-600") : "bg-muted-foreground/30"}`}
            >
                <div className={`absolute top-1 h-4 w-4 rounded-full bg-foreground shadow transition-transform ${value ? "translate-x-6" : "translate-x-1"}`} />
            </button>
        </div>
    );
}
