"use client";

import { useEffect, useState, useCallback } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Loader2, Shield, Save, Palette, Globe, Mail, Settings, ToggleLeft, ToggleRight } from "lucide-react";
import SiteNavbar from "@/components/navbar/SiteNavbar";

type WhiteLabelConfig = {
    brandName: string;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    logoUrl: string;
    faviconUrl: string;
    customDomain: string;
    footerText: string;
    contactEmail: string;
    features: {
        copyTrading: boolean;
        marketplace: boolean;
        alerts: boolean;
        socialFeed: boolean;
        apiAccess: boolean;
        customDashboard: boolean;
    };
};

export default function WhiteLabelPage() {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [config, setConfig] = useState<WhiteLabelConfig>({
        brandName: "", primaryColor: "#7c3aed", secondaryColor: "#3b82f6", accentColor: "#06b6d4",
        logoUrl: "", faviconUrl: "", customDomain: "", footerText: "", contactEmail: "",
        features: { copyTrading: true, marketplace: true, alerts: true, socialFeed: true, apiAccess: true, customDashboard: true },
    });

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
        return () => unsub();
    }, []);

    const fetchConfig = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/whitelabel", { headers: { Authorization: `Bearer ${token}` } });
            const json = await res.json();
            if (json.success) setConfig(json.config);
        } catch {} finally { setLoading(false); }
    }, [user]);

    useEffect(() => { if (user) void Promise.resolve().then(() => fetchConfig()); }, [user, fetchConfig]);

    const saveConfig = async () => {
        if (!user) return;
        setSaving(true);
        try {
            const token = await user.getIdToken();
            await fetch("/api/whitelabel", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify(config),
            });
        } catch {} finally { setSaving(false); }
    };

    const toggleFeature = (key: keyof WhiteLabelConfig["features"]) => {
        setConfig((c) => ({ ...c, features: { ...c.features, [key]: !c.features[key] } }));
    };

    if (authLoading) {
        return (<div className="flex min-h-screen flex-col bg-background"><SiteNavbar /><div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div></div>);
    }

    if (!user) {
        return (<div className="flex min-h-screen flex-col bg-background"><SiteNavbar /><div className="flex flex-1 flex-col items-center justify-center gap-4"><Shield size={40} className="text-muted-foreground" /><h1 className="text-xl font-semibold text-foreground">Admin access required</h1></div></div>);
    }

    return (
        <div className="min-h-screen bg-background">
            <SiteNavbar />
            <div className="mx-auto max-w-3xl px-4 py-8">
                <div data-guide="page-header" className="mb-6 flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">White-Label Configuration</h1>
                        <p className="mt-1 text-sm text-muted-foreground">Customize branding, colors, and feature toggles</p>
                    </div>
                    <button type="button" onClick={saveConfig} disabled={saving || loading} className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-foreground hover:bg-violet-500 transition disabled:opacity-50">
                        {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
                    </button>
                </div>

                {loading ? (
                    <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-violet-400" /></div>
                ) : (
                    <div className="space-y-6">
                        {/* Branding */}
                        <div className="rounded-xl border border-border/30 bg-muted/50 p-5">
                            <div className="flex items-center gap-2 mb-4"><Palette size={16} className="text-violet-400" /><h2 className="text-sm font-semibold text-foreground">Branding</h2></div>
                            <div className="space-y-3">
                                <div>
                                    <label className="mb-1 block text-xs text-muted-foreground">Brand Name</label>
                                    <input type="text" value={config.brandName} onChange={(e) => setConfig((c) => ({ ...c, brandName: e.target.value }))} className="w-full rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none" />
                                </div>
                                <div className="grid grid-cols-3 gap-3">
                                    <div>
                                        <label className="mb-1 block text-xs text-muted-foreground">Primary</label>
                                        <div className="flex gap-2">
                                            <input type="color" value={config.primaryColor} onChange={(e) => setConfig((c) => ({ ...c, primaryColor: e.target.value }))} className="h-10 w-10 cursor-pointer rounded-lg border-0" />
                                            <input type="text" value={config.primaryColor} onChange={(e) => setConfig((c) => ({ ...c, primaryColor: e.target.value }))} className="flex-1 rounded-lg border border-border/40 bg-muted px-2 py-1 font-mono text-xs text-foreground focus:border-violet-500 focus:outline-none" />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs text-muted-foreground">Secondary</label>
                                        <div className="flex gap-2">
                                            <input type="color" value={config.secondaryColor} onChange={(e) => setConfig((c) => ({ ...c, secondaryColor: e.target.value }))} className="h-10 w-10 cursor-pointer rounded-lg border-0" />
                                            <input type="text" value={config.secondaryColor} onChange={(e) => setConfig((c) => ({ ...c, secondaryColor: e.target.value }))} className="flex-1 rounded-lg border border-border/40 bg-muted px-2 py-1 font-mono text-xs text-foreground focus:border-violet-500 focus:outline-none" />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs text-muted-foreground">Accent</label>
                                        <div className="flex gap-2">
                                            <input type="color" value={config.accentColor} onChange={(e) => setConfig((c) => ({ ...c, accentColor: e.target.value }))} className="h-10 w-10 cursor-pointer rounded-lg border-0" />
                                            <input type="text" value={config.accentColor} onChange={(e) => setConfig((c) => ({ ...c, accentColor: e.target.value }))} className="flex-1 rounded-lg border border-border/40 bg-muted px-2 py-1 font-mono text-xs text-foreground focus:border-violet-500 focus:outline-none" />
                                        </div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="mb-1 block text-xs text-muted-foreground">Logo URL</label>
                                        <input type="url" value={config.logoUrl} onChange={(e) => setConfig((c) => ({ ...c, logoUrl: e.target.value }))} placeholder="https://..." className="w-full rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none" />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs text-muted-foreground">Favicon URL</label>
                                        <input type="url" value={config.faviconUrl} onChange={(e) => setConfig((c) => ({ ...c, faviconUrl: e.target.value }))} placeholder="https://..." className="w-full rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none" />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Domain & Contact */}
                        <div className="rounded-xl border border-border/30 bg-muted/50 p-5">
                            <div className="flex items-center gap-2 mb-4"><Globe size={16} className="text-violet-400" /><h2 className="text-sm font-semibold text-foreground">Domain & Contact</h2></div>
                            <div className="space-y-3">
                                <div>
                                    <label className="mb-1 block text-xs text-muted-foreground">Custom Domain</label>
                                    <input type="text" value={config.customDomain} onChange={(e) => setConfig((c) => ({ ...c, customDomain: e.target.value }))} placeholder="trading.yourbrand.com" className="w-full rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none" />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs text-muted-foreground">Contact Email</label>
                                    <input type="email" value={config.contactEmail} onChange={(e) => setConfig((c) => ({ ...c, contactEmail: e.target.value }))} placeholder="support@yourbrand.com" className="w-full rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-violet-500 focus:outline-none" />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs text-muted-foreground">Footer Text</label>
                                    <input type="text" value={config.footerText} onChange={(e) => setConfig((c) => ({ ...c, footerText: e.target.value }))} className="w-full rounded-xl border border-border/40 bg-muted px-3 py-2.5 text-sm text-foreground focus:border-violet-500 focus:outline-none" />
                                </div>
                            </div>
                        </div>

                        {/* Feature Toggles */}
                        <div className="rounded-xl border border-border/30 bg-muted/50 p-5">
                            <div className="flex items-center gap-2 mb-4"><Settings size={16} className="text-violet-400" /><h2 className="text-sm font-semibold text-foreground">Feature Toggles</h2></div>
                            <div className="space-y-2">
                                {(Object.entries(config.features) as [keyof WhiteLabelConfig["features"], boolean][]).map(([key, enabled]) => (
                                    <button key={key} type="button" onClick={() => toggleFeature(key)} className="flex w-full items-center justify-between rounded-xl border border-border/30 bg-muted/50 px-4 py-3 transition hover:bg-muted">
                                        <span className="text-sm text-muted-foreground capitalize">{key.replace(/([A-Z])/g, " $1")}</span>
                                        {enabled ? <ToggleRight size={22} className="text-emerald-400" /> : <ToggleLeft size={22} className="text-muted-foreground" />}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
