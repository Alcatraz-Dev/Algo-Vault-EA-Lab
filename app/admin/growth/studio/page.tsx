"use client";

import { useState, useMemo } from "react";
import {
  Plus, RefreshCw, Search, Play, CheckCircle2, XCircle, ShieldCheck,
  MonitorPlay, Sparkles, Trash2, Edit3, Copy, Film
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAdminFetch } from "@/components/growth/admin/useAdminFetch";
import { adminFetch } from "@/components/growth/admin/session";
import { GrowthStatusBadge } from "@/components/growth/admin/GrowthStatusBadge";

export default function MarketingStudioPage() {
  const campaigns = useAdminFetch<{ id: string; name: string; objective: string; status: string; createdAt: number; campaignId?: string }[]>("/api/admin/growth/marketing/campaigns");
  const [query, setQuery] = useState("");
  const [openCampaign, setOpenCampaign] = useState(false);
  const [form, setForm] = useState({ name: "", feature: "AlgoVault AI Signals", audience: "Traders", objective: "EDUCATION", platform: "TIKTOK", language: "en", durationSec: 30, aspectRatio: "9:16", tone: "professional", cta: "Try AlgoVault today.", concepts: 3, variants: 3 });
  const [concepts, setConcepts] = useState<Array<{ id: string; hook: string; angle: string; audience: string; cta: string; status: string; durationSec: number }>>([]);
  const [activeCampaignId, setActiveCampaignId] = useState<string>("");

  const filtered = useMemo(() => {
    const list = (Array.isArray(campaigns) ? campaigns : (campaigns?.data || [])) as Array<{ id: string; name: string; feature?: string }>;
    return list.filter((c: any) => (c.name || "").toLowerCase().includes(query.toLowerCase()) || (c.feature || "").toLowerCase().includes(query.toLowerCase()));
  }, [campaigns, query]);

  const handleCreateCampaign = async () => {
    try {
      const data = await adminFetch<{ id?: string; campaignId?: string }>("/api/admin/growth/marketing/campaigns", {
        method: "POST",
        body: JSON.stringify({ ...form, createdBy: "admin", status: "DRAFT" }),
      });
      setActiveCampaignId(data.id || data.campaignId || "");
      setOpenCampaign(false);
    } catch { /* silent on error */ }
  };

  const handleGenerateConcept = async () => {
    try {
      const data = await adminFetch<{ concepts?: Array<{ hook?: string; angle?: string; audience?: string; cta?: string; status?: string }> }>(`/api/admin/growth/marketing/campaigns/${activeCampaignId || "new"}/concepts`, {
        method: "POST",
        body: JSON.stringify({ feature: form.feature, audience: form.audience, objective: form.objective, count: form.concepts }),
      });
      setConcepts((data.concepts || []).map((c, i: number) => ({ id: `cpt_${i}`, hook: c.hook || "Demo hook", angle: c.angle || "Education", audience: c.audience || form.audience, cta: c.cta || form.cta, status: "READY", durationSec: form.durationSec })));
    } catch { /* silent */ }
  };

  const handleRegenerate = (conceptId: string) => {
    setConcepts((prev) => prev.map((c) => c.id === conceptId ? { ...c, status: "REGENERATING" } : c));
    setTimeout(() => setConcepts((prev) => prev.map((c) => c.id === conceptId ? { ...c, status: "READY" } : c)), 1200);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Marketing Studio</h1>
          <p className="text-sm text-muted-foreground">Campaigns → Concepts → Scripts → Video</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpenCampaign(true)}><Plus size={14} /> New Campaign</Button>
          <Button size="sm" onClick={() => handleGenerateConcept()} disabled={!activeCampaignId}><Sparkles size={14} /> Generate Concepts</Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[320px_1fr] gap-4">
        {/* Campaign List */}
        <div className="border rounded-2xl bg-card p-4 space-y-3 overflow-y-auto max-h-[80vh]">
          <div className="flex gap-2">
            <Input placeholder="Search campaigns..." value={query} onChange={(e) => setQuery(e.target.value)} className="h-8 text-xs" />
            <Button size="icon" variant="outline" className="h-8 w-8"><RefreshCw size={14} /></Button>
          </div>
          {(filtered || []).length === 0 ? (
            <div className="text-xs text-muted-foreground">No campaigns found.</div>
          ) : (
            (filtered || []).map((c: any) => (
              <button key={c.id} onClick={() => setActiveCampaignId(c.id)} className={`w-full text-left rounded-lg border px-3 py-2 text-xs transition ${activeCampaignId === c.id ? "bg-muted/60 border-primary" : "bg-card hover:bg-muted/40"}`}>
                <div className="font-medium truncate">{c.name || "Untitled"}</div>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{c.objective || "EDUCATION"}</Badge>
                  <span>{new Date(c.createdAt || 0).toLocaleDateString()}</span>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Main Studio Area */}
        <div className="space-y-6">
          {/* Campaign Header */}
          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold">{form.feature}</h2>
                <Badge variant="outline">{form.objective}</Badge>
                <Badge variant="outline">{form.aspectRatio}</Badge>
                <Badge variant="outline">{form.durationSec}s</Badge>
              </div>
              <div className="flex gap-2 text-xs text-muted-foreground">
                <span>Audience: {form.audience}</span>
                <span>•</span>
                <span>Tone: {form.tone}</span>
                <span>•</span>
                <span>CTA: {form.cta.length > 30 ? form.cta.slice(0, 30) + "…" : form.cta}</span>
              </div>
            </CardContent>
          </Card>

          {/* Concept Cards */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-base font-semibold">Concepts</h3>
              <span className="text-xs text-muted-foreground">{concepts.length} generated</span>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              {(concepts || []).map((c: any) => (
                <Card key={c.id} className="relative hover:shadow-md transition">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-medium text-sm">{c.hook}</h4>
                        <Badge variant="secondary" className="text-[10px] mt-1">{c.angle}</Badge>
                      </div>
                      <GrowthStatusBadge kind="task" value={c.status} />
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <div>Audience: {c.audience}</div>
                      <div>Duration: {c.durationSec}s • CTA: {c.cta}</div>
                    </div>
                    <div className="flex gap-1 pt-1">
                      <Button size="sm" variant="outline" className="h-7 text-xs"><Edit3 size={12} /> Edit</Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleRegenerate(c.id)}><RefreshCw size={12} /> Regen</Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setConcepts((prev) => prev.filter((x) => x.id !== c.id))}><Trash2 size={12} /></Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {concepts.length === 0 && (
                <div className="col-span-full text-sm text-muted-foreground">Generate concepts to see cards.</div>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-base font-semibold mb-3">Video Preview</h3>
            <div className="rounded-xl overflow-hidden bg-black relative aspect-video">
              <video controls className="w-full h-full" poster="/marketing-video/assets/01-market-hero.png" src="" />
              <div className="absolute bottom-3 left-3 bg-black/70 text-white text-xs px-2 py-0.5 rounded">Marketing Studio — preview only</div>
            </div>
          </section>

          <section>
            <h3 className="text-base font-semibold mb-3">Scene Editor</h3>
            <div className="rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
              <p>Scene editor active for selected concept. Use script generation to populate scenes, then edit duration, narration, visual reference, and overlay per scene.</p>
              <div className="mt-2 flex gap-2 text-xs">
                <Button size="sm" variant="outline">Add Scene</Button>
                <Button size="sm" variant="outline">Reorder</Button>
                <Button size="sm" variant="outline">Generate Visuals</Button>
                <Button size="sm" variant="outline">Generate Voice</Button>
              </div>
            </div>
          </section>

          {/* Pipeline Status */}
          <section>
            <h3 className="text-base font-semibold mb-3">Pipeline Status</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-7 gap-2 text-xs">
              {[
                { label: "Concept", done: concepts.length > 0 },
                { label: "Script", done: false },
                { label: "Visuals", done: false },
                { label: "Voice", done: false },
                { label: "Render", done: false },
                { label: "Compliance", done: false },
                { label: "Ready", done: false },
              ].map((s) => (
                <div key={s.label} className={`rounded-lg border px-3 py-2 ${s.done ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-card"}`}>
                  <div className="font-medium">{s.label}</div>
                  <div className="text-[10px] text-muted-foreground">{s.done ? "✓" : "●"}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      {/* Create Campaign Dialog */}
      <Dialog open={openCampaign} onOpenChange={setOpenCampaign}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Create Marketing Campaign</DialogTitle></DialogHeader>
          <div className="grid gap-3 text-sm">
            <Input placeholder="Campaign name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder="Product / feature" value={form.feature} onChange={(e) => setForm({ ...form, feature: e.target.value })} />
            <Input placeholder="Audience" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} />
            <Input placeholder="Objective" value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} />
            <Input placeholder="Platform" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} />
            <Input placeholder="Language" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} />
            <Input placeholder="Duration (sec)" type="number" value={form.durationSec} onChange={(e) => setForm({ ...form, durationSec: Number(e.target.value) })} />
            <Input placeholder="Aspect ratio" value={form.aspectRatio} onChange={(e) => setForm({ ...form, aspectRatio: e.target.value })} />
            <Input placeholder="Tone" value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })} />
            <Input placeholder="CTA" value={form.cta} onChange={(e) => setForm({ ...form, cta: e.target.value })} />
            <Input placeholder="Concepts" type="number" value={form.concepts} onChange={(e) => setForm({ ...form, concepts: Number(e.target.value) })} />
            <Input placeholder="Variants" type="number" value={form.variants} onChange={(e) => setForm({ ...form, variants: Number(e.target.value) })} />
          </div>
          <DialogFooter>
            <Button onClick={handleCreateCampaign}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}