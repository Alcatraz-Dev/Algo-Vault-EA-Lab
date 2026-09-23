"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, AlertTriangle, XCircle, CheckCircle2, Info, ArrowRight } from "lucide-react";
import { auth } from "@/lib/firebase";

interface AiBuilderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplyGeneratedWorkflow: (workflow: { name: string; description: string; nodes: any[]; edges: any[] }) => void;
}

export function AiBuilderModal({ open, onOpenChange, onApplyGeneratedWorkflow }: AiBuilderModalProps) {
  const [prompt, setPrompt] = useState("");
  const [symbol, setSymbol] = useState("XAUUSD");
  const [timeframe, setTimeframe] = useState("M5");
  const [channel, setChannel] = useState("telegram");

  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const [customName, setCustomName] = useState("");
  const [customDesc, setCustomDesc] = useState("");

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setGenError(null);
    setResult(null);

    try {
      const token = await auth.currentUser?.getIdToken();
      const combinedPrompt = `${prompt.trim()}. Preferred symbol: ${symbol}, timeframe: ${timeframe}, notification channel: ${channel}.`;

      const res = await fetch("/api/workflows/generate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: combinedPrompt }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Workflow generation failed.");
      }

      setResult(data);
      if (data.draft?.workflow) {
        setCustomName(data.draft.workflow.name || "AI Generated Workflow");
        setCustomDesc(data.draft.workflow.description || prompt.slice(0, 120));
      }
    } catch (err: any) {
      setGenError(err.message || "Failed to generate workflow.");
    } finally {
      setGenerating(false);
    }
  };

  const handleApply = () => {
    if (!result?.draft?.workflow) return;
    const wf = result.draft.workflow;
    onApplyGeneratedWorkflow({
      name: customName || wf.name,
      description: customDesc || wf.description,
      nodes: wf.nodes ?? [],
      edges: wf.edges ?? [],
    });
    onOpenChange(false);
  };

  const validation = result?.validation;
  const isInvalid = validation && !validation.valid;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl lg:max-w-6xl w-[95vw] max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Sparkles className="w-5 h-5 text-blue-500" />
            Build Workflow with AI
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Describe your strategy in plain language. The AI Router will construct a safe, validated node DAG.
          </DialogDescription>
        </DialogHeader>

        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Inputs section */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Natural Language Strategy Prompt</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder="e.g. Monitor XAUUSD on M5. Confirm the trend on H1. If RSI is below 30 and the higher timeframe trend is bullish, generate a signal and send me a Telegram alert."
                className="w-full text-xs p-3 rounded-lg border bg-background resize-none focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] text-muted-foreground font-medium mb-1">Target Symbol</label>
                <Input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  placeholder="XAUUSD"
                  className="text-xs h-8"
                />
              </div>
              <div>
                <label className="block text-[11px] text-muted-foreground font-medium mb-1">Primary Timeframe</label>
                <select
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value)}
                  className="w-full text-xs h-8 rounded-md border px-2 bg-background"
                >
                  <option value="M1">M1 (1 min)</option>
                  <option value="M5">M5 (5 min)</option>
                  <option value="M15">M15 (15 min)</option>
                  <option value="H1">H1 (1 hour)</option>
                  <option value="H4">H4 (4 hours)</option>
                  <option value="D1">D1 (Daily)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-muted-foreground font-medium mb-1">Notification Channel</label>
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  className="w-full text-xs h-8 rounded-md border px-2 bg-background"
                >
                  <option value="telegram">Telegram</option>
                  <option value="discord">Discord</option>
                  <option value="email">Email</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end">
              <Button size="sm" onClick={handleGenerate} disabled={generating || !prompt.trim()}>
                {generating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-1.5" /> Generate Workflow
                  </>
                )}
              </Button>
            </div>
          </div>

          {genError && (
            <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
              <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold">Generation Error</div>
                <div>{genError}</div>
              </div>
            </div>
          )}

          {/* Generated Result Preview */}
          {result && result.draft?.workflow && (
            <div className="border rounded-xl p-4 bg-muted/20 space-y-4">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="font-bold text-xs uppercase text-muted-foreground tracking-wider">
                  AI Generation Preview
                </span>
                <Badge variant={isInvalid ? "destructive" : "default"} className="text-[10px]">
                  {isInvalid ? "Validation Failed" : "Validated & Ready"}
                </Badge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Workflow Name</label>
                  <Input
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    className="text-xs h-8"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">Description</label>
                  <Input
                    value={customDesc}
                    onChange={(e) => setCustomDesc(e.target.value)}
                    className="text-xs h-8"
                  />
                </div>
              </div>

              {/* Validation Feedback */}
              {validation && (
                <div className="space-y-1 text-xs">
                  {validation.errors?.map((err: string, i: number) => (
                    <div key={i} className="flex items-center gap-1.5 text-red-600 dark:text-red-400 font-medium">
                      <XCircle className="w-3.5 h-3.5 shrink-0" /> {err}
                    </div>
                  ))}
                  {validation.warnings?.map((warn: string, i: number) => (
                    <div key={i} className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {warn}
                    </div>
                  ))}
                  {validation.valid && validation.errors?.length === 0 && (
                    <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> Workflow passed server-side validation.
                    </div>
                  )}
                </div>
              )}

              {/* Nodes and Edges Structure */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground">
                  Generated Structure ({result.draft.workflow.nodes?.length ?? 0} nodes · {result.draft.workflow.edges?.length ?? 0} connections)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[160px] overflow-y-auto p-1">
                  {result.draft.workflow.nodes?.map((node: any) => (
                    <div key={node.id} className="p-2 rounded border bg-card text-xs flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                      <div className="truncate flex-1">
                        <div className="font-semibold truncate">{node.label || node.id}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{node.type}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t flex justify-end gap-2 bg-background">
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {result && (
            <Button size="sm" onClick={handleApply} disabled={isInvalid}>
              Apply to Canvas
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
