"use client";

import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { WORKFLOW_TEMPLATES, WorkflowTemplate } from "@/lib/workflows/templates";
import { Search, Sparkles, Zap, ArrowRight, Layers, CheckCircle2, GitBranch, X } from "lucide-react";

interface TemplatePickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectTemplate: (template: WorkflowTemplate, customSymbol?: string) => void;
}

export function TemplatePickerModal({ open, onOpenChange, onSelectTemplate }: TemplatePickerModalProps) {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(WORKFLOW_TEMPLATES[0]?.id ?? "");
  const [symbolOverride, setSymbolOverride] = useState<string>("");

  const categories = useMemo(() => {
    const cats = Array.from(new Set(WORKFLOW_TEMPLATES.map((t) => t.category)));
    return ["All", ...cats];
  }, []);

  const filteredTemplates = useMemo(() => {
    return WORKFLOW_TEMPLATES.filter((t) => {
      const matchCat = selectedCategory === "All" || t.category === selectedCategory;
      const matchSearch =
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.description.toLowerCase().includes(search.toLowerCase()) ||
        t.category.toLowerCase().includes(search.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [search, selectedCategory]);

  const activeTemplate = useMemo(() => {
    return WORKFLOW_TEMPLATES.find((t) => t.id === selectedTemplateId) ?? WORKFLOW_TEMPLATES[0];
  }, [selectedTemplateId]);

  const handleApply = () => {
    if (!activeTemplate) return;
    onSelectTemplate(activeTemplate, symbolOverride.trim() || undefined);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full h-[92vh] max-h-[850px] flex flex-col p-0 overflow-hidden rounded-2xl sm:w-[95vw] sm:max-w-2xl md:max-w-4xl lg:max-w-6xl">
        {/* Header */}
        <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-3 sm:pb-4 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                <Sparkles size={20} className="text-blue-500" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-bold text-foreground">Workflow Templates</h2>
                <p className="text-xs text-muted-foreground hidden sm:block">
                  Select a battle-tested trading workflow template to kickstart your automation.
                </p>
              </div>
            </div>
          </div>

          {/* Search and categories */}
          <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2.5">
            <div className="relative flex-1 min-w-0">
              <Search size={14} className="absolute left-3 top-2.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search templates…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 text-xs sm:text-sm h-9"
              />
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`text-xs px-2.5 py-1 rounded-lg border transition-colors capitalize whitespace-nowrap ${
                    selectedCategory === cat
                      ? "bg-primary text-primary-foreground border-primary font-medium"
                      : "border-border bg-background hover:bg-muted text-foreground"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Body – responsive split panel */}
        <div className="flex flex-col lg:grid lg:grid-cols-12 flex-1 min-h-0 overflow-y-auto lg:overflow-hidden">
          {/* Templates list – top on mobile, left on lg */}
          <div className="lg:col-span-5 border-b lg:border-b-0 lg:border-r border-border overflow-y-auto p-3 sm:p-4 space-y-2 max-h-[220px] sm:max-h-[280px] lg:max-h-full lg:h-full shrink-0 lg:shrink">
            {filteredTemplates.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center space-y-2">
                <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center">
                  <Search size={16} className="text-muted-foreground" />
                </div>
                <p className="text-xs text-muted-foreground">No templates found matching your filter.</p>
              </div>
            ) : (
              filteredTemplates.map((tpl) => {
                const isSelected = tpl.id === selectedTemplateId;
                return (
                  <div
                    key={tpl.id}
                    onClick={() => {
                      setSelectedTemplateId(tpl.id);
                      setSymbolOverride(tpl.defaultSymbol ?? "");
                    }}
                    className={`p-3 sm:p-4 rounded-xl border cursor-pointer transition-all ${
                      isSelected
                        ? "border-blue-500/50 bg-blue-500/10 ring-1 ring-blue-500/30 shadow-sm"
                        : "border-border hover:bg-muted/30 hover:border-muted-foreground/20"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-xs sm:text-sm text-foreground truncate">{tpl.name}</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 shrink-0 ml-2">
                        {tpl.category}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{tpl.description}</p>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Layers size={12} className="text-blue-500" /> {tpl.nodeCount} nodes
                      </span>
                      {tpl.defaultSymbol && (
                        <span className="flex items-center gap-1">
                          <Zap size={12} className="text-amber-500" /> {tpl.defaultSymbol}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Details panel – bottom on mobile, right on lg */}
          <div className="lg:col-span-7 overflow-y-auto p-4 sm:p-6 flex flex-col gap-4 sm:gap-5 flex-1 lg:h-full">
            {activeTemplate ? (
              <>
                {/* Title + description */}
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Badge variant="outline" className="text-xs px-2 py-0.5">{activeTemplate.category}</Badge>
                  </div>
                  <h3 className="text-lg sm:text-xl font-bold text-foreground mb-1">{activeTemplate.name}</h3>
                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">{activeTemplate.description}</p>
                </div>

                {/* Required inputs */}
                <div className="rounded-xl border border-border p-3.5 sm:p-4 bg-card space-y-3">
                  <div className="text-xs sm:text-sm font-semibold flex items-center gap-2 text-foreground">
                    <CheckCircle2 size={15} className="text-emerald-500" /> Required Inputs
                  </div>
                  <ul className="text-xs space-y-1 list-disc list-inside text-muted-foreground">
                    {activeTemplate.requiredInputs.map((req, idx) => (
                      <li key={idx}>{req}</li>
                    ))}
                  </ul>
                  <div className="pt-2 border-t border-border flex flex-col sm:flex-row sm:items-center gap-2">
                    <label className="text-xs font-medium text-foreground shrink-0">Custom Symbol Override:</label>
                    <Input
                      placeholder={activeTemplate.defaultSymbol ?? "e.g. XAUUSD"}
                      value={symbolOverride}
                      onChange={(e) => setSymbolOverride(e.target.value)}
                      className="text-xs h-8 sm:h-9 max-w-full sm:max-w-[200px]"
                    />
                  </div>
                </div>

                {/* Node flow */}
                <div className="space-y-2.5">
                  <div className="text-xs sm:text-sm font-semibold text-foreground">Workflow Node Flow</div>
                  <div className="space-y-2">
                    {activeTemplate.nodes.map((node, i) => (
                      <div key={node.id}
                        className="flex items-center gap-2.5 p-2.5 sm:p-3 rounded-xl border border-border bg-card">
                        <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-blue-500/10 text-blue-500 font-bold text-xs flex items-center justify-center shrink-0">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs sm:text-sm font-medium text-foreground truncate">{node.label || node.id}</div>
                          <div className="text-[10px] sm:text-[11px] text-muted-foreground truncate">{node.type}</div>
                        </div>
                        {i < activeTemplate.nodes.length - 1 && (
                          <ArrowRight size={14} className="text-muted-foreground shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs sm:text-sm text-muted-foreground py-10">
                Select a template from the left to view details.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 border-t border-border flex items-center justify-between bg-card shrink-0">
          <p className="text-xs text-muted-foreground hidden sm:block">
            {filteredTemplates.length} template{filteredTemplates.length !== 1 ? "s" : ""} available
          </p>
          <div className="flex gap-2 w-full sm:w-auto justify-end">
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={handleApply} disabled={!activeTemplate}>
              <Sparkles size={14} className="mr-1.5" /> Use This Template
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
