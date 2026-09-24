import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  CopyIcon, Trash2, X, Power, PowerOff,
  ChevronDown, ChevronRight, Settings2, Info, Layers,
} from "lucide-react";
import { Node } from "@xyflow/react";
import { useState } from "react";

/* ─── Config field ────────────────────────────────────────────────────────────── */
interface ConfigFieldProps {
  field: any;
  value: any;
  onChange: (val: any) => void;
}

export function ConfigField({ field, value, onChange }: ConfigFieldProps) {
  if (field.type === "string" || field.type === "template") {
    return (
      <Input
        className="h-8 text-xs bg-background border-border"
        value={String(value ?? "")}
        placeholder={field.placeholder || `Enter ${field.label?.toLowerCase() ?? "value"}…`}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (field.type === "number") {
    return (
      <Input
        className="h-8 text-xs bg-background border-border"
        type="number"
        value={String(value ?? 0)}
        placeholder={field.placeholder || "0"}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    );
  }
  if (field.type === "boolean") {
    return (
      <label className="inline-flex items-center gap-2 cursor-pointer">
        <div className="relative">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)}
            className="sr-only peer" />
          <div className="w-9 h-5 rounded-full bg-muted peer-checked:bg-emerald-500 transition-colors" />
          <div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
        </div>
        <span className="text-xs text-muted-foreground">{value ? "On" : "Off"}</span>
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <select
        className="w-full text-xs rounded-lg border border-border px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        value={String(value ?? (field.options?.[0]?.value ?? ""))}
        onChange={(e) => onChange(e.target.value)}
      >
        {field.options?.map((o: any) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }
  if (field.type === "multiselect") {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="flex flex-wrap gap-1.5">
        {field.options?.map((o: any) => {
          const sel = arr.includes(o.value);
          return (
            <button key={o.value} type="button"
              className={`text-[10px] px-2.5 py-1 rounded-full border transition-all ${
                sel ? "bg-primary/15 border-primary/40 text-primary font-medium" : "bg-muted border-border text-muted-foreground hover:border-primary/30"
              }`}
              onClick={() => onChange(sel ? arr.filter((v) => v !== o.value) : [...arr, o.value])}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }
  if (field.type === "secret") {
    return (
      <Input
        className="h-8 text-xs bg-background border-border font-mono"
        type="password"
        value={String(value ?? "")}
        placeholder="••••••••"
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (field.type === "json") {
    const display = typeof value === "string"
      ? value
      : (() => { try { return JSON.stringify(value ?? {}, null, 2); } catch { return String(value ?? ""); } })();
    return (
      <textarea
        className="w-full text-xs rounded-lg border border-border bg-background font-mono px-2.5 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 min-h-[72px] resize-y placeholder:text-muted-foreground/60"
        value={display}
        placeholder={field.placeholder || '{ "key": "value" }'}
        spellCheck={false}
        onChange={(e) => {
          const raw = e.target.value;
          const trimmed = raw.trim();
          if (!trimmed) { onChange(""); return; }
          try { onChange(JSON.parse(trimmed)); } catch { onChange(raw); }
        }}
      />
    );
  }
  return (
    <Input
      className="h-8 text-xs bg-background border-border"
      value={String(value ?? "")}
      placeholder={`Enter ${field.label?.toLowerCase() ?? "value"}…`}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/* ─── Collapsible section ──────────────────────────────────────────────────── */
function Section({ title, icon, children, defaultOpen = true }: {
  title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-foreground bg-muted/40 hover:bg-muted/60 transition-colors">
        {icon}
        <span className="flex-1 text-left">{title}</span>
        {open ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />}
      </button>
      {open && <div className="p-3 space-y-3 bg-background">{children}</div>}
    </div>
  );
}

/* ─── Main Inspector ───────────────────────────────────────────────────────── */
interface InspectorProps {
  selectedNode: Node | null;
  selectedDef: any;
  nodes: Node[];
  setNodes: any;
  setSelectedId: (id: string | null) => void;
  deleteNode: () => void;
}

export function Inspector({ selectedNode, selectedDef, nodes, setNodes, setSelectedId, deleteNode }: InspectorProps) {
  if (!selectedNode) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center py-8">
        <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center">
          <Settings2 size={20} className="text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">No Node Selected</p>
          <p className="text-[10px] text-muted-foreground/70 max-w-[180px]">
            Click on a node in the canvas to view and edit its configuration.
          </p>
        </div>
      </div>
    );
  }

  const selectedId = selectedNode.id;
  const nodeData = (selectedNode.data as any)?.node;
  const config = nodeData?.config ?? {};

  function updateConfig(fieldKey: string, val: any) {
    setNodes((nds: Node[]) =>
      nds.map((n) =>
        n.id === selectedId
          ? { ...n, data: { ...n.data, node: { ...nodeData, config: { ...config, [fieldKey]: val } } } }
          : n
      )
    );
  }

  function updateLabel(label: string) {
    setNodes((nds: Node[]) =>
      nds.map((n) =>
        n.id === selectedId
          ? { ...n, data: { ...n.data, node: { ...nodeData, label } } }
          : n
      )
    );
  }

  function updateEnabled(checked: boolean) {
    setNodes((nds: Node[]) =>
      nds.map((n) =>
        n.id === selectedId
          ? { ...n, data: { ...n.data, node: { ...nodeData, enabled: checked } } }
          : n
      )
    );
  }

  const isEnabled = nodeData?.enabled !== false;
  const configFields = selectedDef?.configSchema ?? [];

  return (
    <div className="flex-1 overflow-y-auto space-y-3 pr-0.5">

      {/* ── Node Header ── */}
      <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Input
              value={nodeData?.label || ""}
              onChange={(e) => updateLabel(e.target.value)}
              className="h-7 text-sm font-semibold border-none bg-transparent px-0 focus-visible:ring-0 text-foreground"
              placeholder="Node label"
            />
          </div>
          <button onClick={() => setSelectedId(null)}
            className="text-muted-foreground hover:text-foreground shrink-0 p-1 rounded-md hover:bg-muted transition-colors"
            title="Deselect">
            <X size={13} />
          </button>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground font-medium">
            {selectedDef?.name ?? nodeData?.type}
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground capitalize">{selectedDef?.category ?? "—"}</span>
        </div>
        {selectedDef?.description && (
          <p className="text-[10px] text-muted-foreground leading-relaxed flex items-start gap-1.5">
            <Info size={10} className="shrink-0 mt-0.5 text-blue-500" />
            {selectedDef.description}
          </p>
        )}
      </div>

      {/* ── Enable toggle ── */}
      <Section title="Status" icon={<Layers size={12} className="text-muted-foreground" />}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-foreground">Enabled</p>
            <p className="text-[10px] text-muted-foreground">
              {isEnabled ? "Node will execute during runs" : "Node is disabled and will be skipped"}
            </p>
          </div>
          <label className="inline-flex cursor-pointer">
            <div className="relative">
              <input type="checkbox" checked={isEnabled} onChange={(e) => updateEnabled(e.target.checked)}
                className="sr-only peer" />
              <div className="w-9 h-5 rounded-full bg-muted peer-checked:bg-emerald-500 transition-colors" />
              <div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
            </div>
          </label>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {isEnabled ? <Power size={10} className="text-emerald-500" /> : <PowerOff size={10} className="text-red-500" />}
          <span>Status: {isEnabled ? "Active" : "Disabled"}</span>
        </div>
      </Section>

      {/* ── Configuration fields ── */}
      {configFields.length > 0 && (
        <Section title="Configuration" icon={<Settings2 size={12} className="text-muted-foreground" />}>
          <div className="space-y-3">
            {configFields.map((field: any) => (
              <div key={field.key} className="space-y-1">
                <label className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                  {field.label}
                  {field.required && <span className="text-red-500 text-[9px]">*</span>}
                </label>
                {field.description && (
                  <p className="text-[9px] text-muted-foreground mb-1">{field.description}</p>
                )}
                <ConfigField
                  field={field}
                  value={config[field.key]}
                  onChange={(val: any) => updateConfig(field.key, val)}
                />
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Details ── */}
      <Section title="Details" icon={<Info size={12} className="text-muted-foreground" />} defaultOpen={false}>
        <div className="space-y-2">
          <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">Node ID</span>
            <span className="text-foreground font-mono">{selectedId}</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">Type</span>
            <span className="text-foreground font-mono">{nodeData?.type}</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">Position</span>
            <span className="text-foreground font-mono">
              {Math.round(selectedNode.position?.x ?? 0)}, {Math.round(selectedNode.position?.y ?? 0)}
            </span>
          </div>
        </div>
      </Section>

      {/* ── Actions ── */}
      <div className="flex gap-2 pt-1">
        <Button size="sm" variant="outline" className="flex-1 text-xs"
          onClick={() => {
            const n = nodes.find((x) => x.id === selectedId);
            if (n) {
              const newId = `node_${Math.random().toString(36).slice(2, 8)}`;
              const newNode = {
                ...n, id: newId,
                position: { x: (n.position?.x ?? 0) + 40, y: (n.position?.y ?? 0) + 40 },
                data: { ...n.data, node: { ...nodeData, id: newId } },
              };
              setNodes((nds: Node[]) => [...nds, newNode]);
              setSelectedId(newId);
            }
          }}
        >
          <CopyIcon size={11} className="mr-1.5" /> Duplicate
        </Button>
        <Button size="sm" variant="destructive" className="text-xs" onClick={deleteNode}>
          <Trash2 size={11} className="mr-1.5" /> Delete
        </Button>
      </div>
    </div>
  );
}
