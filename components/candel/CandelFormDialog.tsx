"use client";

import { useMemo, useState } from "react";
import { Loader2, RotateCcw, ShieldCheck, Wrench } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError, FormField } from "@/components/ui/form-field";
import { Select, Textarea } from "@/components/ui/select";
import { CandelAvatar } from "@/components/candel/role-visuals";
import { candelApi, candelErrorMessage } from "@/lib/candel/client";
import { selectableCandelRoles } from "@/lib/candel/roles";
import type { CandelInstance, CandelTemplate } from "@/lib/candel/types";

const AVATAR_PICKS = ["🧠", "📈", "🛡️", "🧪", "📓", "🚀", "🤖", "🎯", "💡", "🦅"];

interface FormState {
  templateId: string;
  name: string;
  description: string;
  role: string;
  avatar: string;
  instructions: string;
  model: string;
  memoryPolicy: "owner" | "shared" | "none";
  tools: string[];
}

function initialState(
  templates: CandelTemplate[],
  instance?: CandelInstance | null,
  defaultTemplateId?: string
): FormState {
  const templateId = instance?.templateId ?? defaultTemplateId ?? templates[0]?.id ?? "";
  const template = templates.find((t) => t.id === templateId);
  const custom = instance?.customization ?? {};
  return {
    templateId,
    name: instance?.displayName || instance?.name || "",
    description: instance?.description || template?.description || "",
    role: custom.role ?? template?.role ?? "general-assistant",
    avatar: custom.avatar ?? "",
    instructions: custom.instructions ?? "",
    model: custom.model ?? "",
    memoryPolicy: custom.memoryPolicy ?? template?.memoryPolicy ?? "owner",
    tools: custom.tools ?? template?.tools ?? [],
  };
}

/**
 * One dialog for both jobs: creating a Candel from a template, and customizing
 * an existing one. The tool list is deliberately read-only in structure — the
 * server only ever allows a *subset* of the template's tools, so the UI offers
 * switches that can turn tooling off but never invent new capabilities.
 */
export function CandelFormDialog({
  open,
  onOpenChange,
  templates,
  instance,
  defaultTemplateId,
  onSaved,
  isPro = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: CandelTemplate[];
  instance?: CandelInstance | null;
  /** Template pre-selected when creating from a specific template card. */
  defaultTemplateId?: string;
  onSaved: (instance: CandelInstance) => void;
  isPro?: boolean;
}) {
  const editing = Boolean(instance);
  const [form, setForm] = useState<FormState>(() =>
    initialState(templates, instance, defaultTemplateId)
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // No state-syncing effect: callers render this dialog only while it is open,
  // so mounting (or a `key` change) is what resets the form.

  const template = useMemo(
    () => templates.find((t) => t.id === form.templateId),
    [templates, form.templateId]
  );

  const ceilingTools = template?.tools ?? [];
  const roles = useMemo(() => selectableCandelRoles({ isPro }), [isPro]);

  function selectTemplate(templateId: string) {
    const next = templates.find((t) => t.id === templateId);
    setForm((prev) => ({
      ...prev,
      templateId,
      role: next?.role ?? prev.role,
      description: prev.description || next?.description || "",
      tools: next?.tools ?? [],
      instructions: "",
    }));
  }

  function toggleTool(tool: string) {
    setForm((prev) => ({
      ...prev,
      tools: prev.tools.includes(tool)
        ? prev.tools.filter((t) => t !== tool)
        : [...prev.tools, tool],
    }));
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError("Give your Candel a name.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        role: form.role,
        avatar: form.avatar.trim(),
        instructions: form.instructions,
        model: form.model.trim(),
        memoryPolicy: form.memoryPolicy,
        tools: form.tools,
      };
      const saved = editing && instance
        ? await candelApi.update(instance.id, payload)
        : await candelApi.create({ ...payload, templateId: form.templateId });
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      setError(candelErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Customize Candel" : "New Candel"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Change the role, instructions and enabled tools. Tools can only be narrowed — the template is the ceiling."
              : "Pick a template, give it a role and name, then tune what it may touch. Nothing can trade on its own."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[60dvh] gap-4 overflow-y-auto pr-1">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
            <CandelAvatar role={form.role} avatar={form.avatar} size="lg" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {form.name.trim() || "Untitled Candel"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {roles.find((r) => r.id === form.role)?.tagline}
              </p>
            </div>
          </div>

          {!editing && (
            <FormField label="Template" required htmlFor="candel-template" description="The template decides the tool ceiling and default instructions.">
              <Select
                id="candel-template"
                value={form.templateId}
                onChange={(event) => selectTemplate(event.target.value)}
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id} disabled={t.proOnly && !isPro}>
                    {t.displayName}
                    {t.proOnly ? " (Pro)" : ""}
                  </option>
                ))}
              </Select>
            </FormField>
          )}

          <FormField label="Name" required htmlFor="candel-name">
            <Input
              id="candel-name"
              value={form.name}
              maxLength={60}
              placeholder="e.g. Gold setups scout"
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </FormField>

          <FormField label="Role" description="Roles shape the default posture and the skills this Candel is expected to use.">
            <div className="grid gap-2 sm:grid-cols-2">
              {roles.map((role) => {
                const active = role.id === form.role;
                return (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => setForm({ ...form, role: role.id })}
                    className={`rounded-lg border px-3 py-2 text-left transition ${
                      active
                        ? "border-primary/50 bg-primary/5"
                        : "border-border hover:border-foreground/25 hover:bg-muted/40"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <CandelAvatar role={role.id} size="sm" />
                      <span className="text-xs font-medium text-foreground">{role.label}</span>
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {role.tagline}
                    </span>
                  </button>
                );
              })}
            </div>
          </FormField>

          <FormField label="Description" htmlFor="candel-description" hint="Shown on the Candel card.">
            <Input
              id="candel-description"
              value={form.description}
              maxLength={400}
              placeholder={template?.description || "What is this Candel for?"}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </FormField>

          <FormField label="Avatar" description="Optional emoji shown instead of the role icon.">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={form.avatar}
                maxLength={8}
                placeholder="🧠"
                className="w-20"
                onChange={(event) => setForm({ ...form, avatar: event.target.value })}
              />
              {AVATAR_PICKS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setForm({ ...form, avatar: emoji })}
                  className="size-8 rounded-md border border-border text-base transition hover:bg-muted"
                >
                  {emoji}
                </button>
              ))}
              {form.avatar ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setForm({ ...form, avatar: "" })}
                >
                  Clear
                </Button>
              ) : null}
            </div>
          </FormField>

          <FormField
            label="Instructions"
            htmlFor="candel-instructions"
            description="The system prompt this Candel runs on. Leave empty to inherit the template."
            hint={template ? "Inherited from the template when left empty." : undefined}
          >
            <Textarea
              id="candel-instructions"
              rows={6}
              value={form.instructions}
              placeholder={template?.instructions || "Describe how this Candel should behave…"}
              onChange={(event) => setForm({ ...form, instructions: event.target.value })}
            />
            {form.instructions ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="mt-1"
                onClick={() => setForm({ ...form, instructions: "" })}
              >
                <RotateCcw className="mr-1 size-3" /> Reset to template
              </Button>
            ) : null}
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Model" htmlFor="candel-model" hint="Empty uses the platform router default.">
              <Input
                id="candel-model"
                value={form.model}
                placeholder={template?.model || "router default"}
                onChange={(event) => setForm({ ...form, model: event.target.value })}
              />
            </FormField>
            <FormField label="Memory" htmlFor="candel-memory">
              <Select
                id="candel-memory"
                value={form.memoryPolicy}
                onChange={(event) =>
                  setForm({
                    ...form,
                    memoryPolicy: event.target.value as FormState["memoryPolicy"],
                  })
                }
              >
                <option value="owner">Private to me</option>
                <option value="shared">Shared with the workspace</option>
                <option value="none">Off — no memory</option>
              </Select>
            </FormField>
          </div>

          <FormField
            label={
              <span className="flex items-center gap-1.5">
                <Wrench className="size-3.5" /> Tools
              </span>
            }
            description="Enabled tools this Candel may use. The template is the ceiling: you can switch tools off, never add new ones."
          >
            {ceilingTools.length === 0 ? (
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                This template ships without tools — the Candel answers from reasoning only.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {ceilingTools.map((tool) => {
                  const enabled = form.tools.includes(tool);
                  return (
                    <label
                      key={tool}
                      className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-xs transition hover:bg-muted/40"
                    >
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={() => toggleTool(tool)}
                        className="size-3.5 accent-primary"
                      />
                      <span className="font-mono text-xs text-foreground">{tool}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </FormField>

          <p className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
            Execution starts disabled. Order-capable tools always route through the approval card and a
            named, explicitly bound account.
          </p>

          {error ? <FormError>{error}</FormError> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={submitting}>
            {submitting ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
            {editing ? "Save changes" : "Create Candel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
