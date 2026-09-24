"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Download, Upload, AlertCircle, CheckCircle2, FileText } from "lucide-react";
import { WorkflowAutomation } from "@/lib/workflows/types";
import { PortableWorkflow, toPortable } from "@/lib/workflows/portable";
import { getNodeDefinition } from "@/lib/workflows/node-registry";
import { validateWorkflow } from "@/lib/workflows/validate";
import { auth } from "@/lib/firebase";

interface ImportExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentWorkflow: WorkflowAutomation | null;
  onImportWorkflow: (importedDef: PortableWorkflow) => void;
}

export function ImportExportModal({
  open,
  onOpenChange,
  currentWorkflow,
  onImportWorkflow,
}: ImportExportModalProps) {
  const [jsonInput, setJsonInput] = useState("");
  const [importValidation, setImportValidation] = useState<{
    valid: boolean;
    errors: string[];
    parsed?: PortableWorkflow;
  } | null>(null);

  const handleExport = async () => {
    if (!currentWorkflow) return;
    try {
      const token = await auth.currentUser?.getIdToken();
      let portableDef: PortableWorkflow;

      if (currentWorkflow.id) {
        const res = await fetch(`/api/workflows/${currentWorkflow.id}/export`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          portableDef = await res.json();
        } else {
          portableDef = toPortable(currentWorkflow);
        }
      } else {
        portableDef = toPortable(currentWorkflow);
      }

      const jsonStr = JSON.stringify(portableDef, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const filename = `${(currentWorkflow.name || "workflow").toLowerCase().replace(/[^a-z0-9]/g, "_")}.json`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
    }
  };

  const handleValidateImport = (rawText: string) => {
    setJsonInput(rawText);
    setImportValidation(null);

    if (!rawText.trim()) return;

    try {
      const parsed = JSON.parse(rawText) as PortableWorkflow;
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.nodes)) {
        setImportValidation({
          valid: false,
          errors: ["Invalid JSON structure: must contain a 'nodes' array."],
        });
        return;
      }

      const errors: string[] = [];

      // Verify all node types against Node Registry
      parsed.nodes.forEach((n, idx) => {
        if (!n.type || !getNodeDefinition(n.type)) {
          errors.push(`Node #${idx + 1} (${n.id || "unknown"}) has unregistered type '${n.type}'.`);
        }
      });

      // Run full workflow engine validation
      const val = validateWorkflow(
        {
          nodes: parsed.nodes as any,
          edges: (parsed.edges ?? []) as any,
          name: parsed.name || "Imported Workflow",
          settings: parsed.settings,
          schedule: parsed.schedule,
        },
        { analysis: true, signal: true, execution: true }
      );

      if (!val.valid) {
        errors.push(...val.errors);
      }

      setImportValidation({
        valid: errors.length === 0,
        errors,
        parsed,
      });
    } catch {
      setImportValidation({
        valid: false,
        errors: ["Invalid JSON format: syntax error."],
      });
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      handleValidateImport(text);
    };
    reader.readAsText(file);
  };

  const handleConfirmImport = () => {
    if (!importValidation?.valid || !importValidation.parsed) return;
    onImportWorkflow(importValidation.parsed);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <FileText className="w-5 h-5 text-blue-500" />
            Import / Export Workflow
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Export sanitized workflow JSON definitions or import external definitions securely.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="export" className="mt-2">
          <TabsList className="grid grid-cols-2">
            <TabsTrigger value="export" className="text-xs">
              <Download className="w-3.5 h-3.5 mr-1.5" /> Export Workflow
            </TabsTrigger>
            <TabsTrigger value="import" className="text-xs">
              <Upload className="w-3.5 h-3.5 mr-1.5" /> Import Workflow
            </TabsTrigger>
          </TabsList>

          <TabsContent value="export" className="space-y-4 pt-4">
            <div className="border rounded-lg p-4 bg-muted/20 space-y-2 text-xs">
              <div className="font-semibold text-sm">{currentWorkflow?.name || "Current Workflow"}</div>
              <p className="text-muted-foreground">
                Exporting produces a portable JSON definition. User ID, webhook secrets, runtime logs, and sensitive configurations will be automatically stripped for safety.
              </p>
              <div className="flex items-center gap-3 pt-2 text-muted-foreground">
                <span>• {currentWorkflow?.nodes?.length ?? 0} Nodes</span>
                <span>• {currentWorkflow?.edges?.length ?? 0} Edges</span>
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={handleExport} disabled={!currentWorkflow}>
                <Download className="w-4 h-4 mr-1.5" /> Download JSON Definition
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="import" className="space-y-4 pt-4">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Upload JSON File or Paste Definition</label>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileUpload}
                  className="block w-full text-xs text-muted-foreground file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-muted file:text-foreground hover:file:bg-muted/80 mb-2 cursor-pointer"
                />
                <textarea
                  value={jsonInput}
                  onChange={(e) => handleValidateImport(e.target.value)}
                  rows={6}
                  placeholder="Paste JSON content here..."
                  className="w-full text-xs font-mono p-3 rounded-lg border bg-background resize-none focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              {importValidation && (
                <div
                  className={`rounded-lg border p-3 text-xs ${
                    importValidation.valid
                      ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300"
                      : "border-red-300 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300"
                  }`}
                >
                  {importValidation.valid ? (
                    <div className="flex items-center gap-1.5 font-medium">
                      <CheckCircle2 className="w-4 h-4 shrink-0" /> Valid Workflow Definition! Ready to import.
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 font-medium">
                        <AlertCircle className="w-4 h-4 shrink-0" /> Validation Failed:
                      </div>
                      <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                        {importValidation.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleConfirmImport} disabled={!importValidation?.valid}>
                Import to Canvas
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
