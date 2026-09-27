/**
 * Copilot conversation engine.
 *
 * Owns everything about an AI chat session on a chart identity:
 *   - thread persistence per `${SYMBOL}|${TIMEFRAME}` (per-symbol memory,
 *     like a research notebook per stock)
 *   - compact rolling memory (bias / levels / plan) distilled from past
 *     assistant answers and injected into every new prompt
 *   - persona + model selection wired to `/api/ai/chat`
 *   - the canonical Chart Context block so answers never fabricate prices
 *
 * Both the side panel and the popup use this engine, so switching between
 * them keeps the same conversation.
 */
import { chatWithAI } from "@/api/algovault";
import { getCopilotThreads, saveCopilotThreads, getCopilotMemory, saveCopilotMemory, getCopilotPrefs, saveCopilotPrefs } from "@/storage/storage";
import { PERSONAS, type CopilotThread, type CopilotMessage, type CopilotMemory, type PersonaId } from "@/types/copilot";

export const COPILOT_MODELS: Array<{ id: string; name: string }> = [
  { id: "", name: "Auto (server default)" },
  { id: "openrouter/free", name: "OpenRouter Auto (free)" },
  { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B (free)" },
  { id: "deepseek/deepseek-r1:free", name: "DeepSeek R1 (free)" },
  { id: "google/gemma-2-9b-it:free", name: "Gemma 2 9B (free)" },
  { id: "qwen/qwen-2.5-coder-32b-instruct:free", name: "Qwen 2.5 Coder 32B (free)" },
  { id: "mimo-v2.5-free", name: "MiMo V2.5 (free)" },
  { id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra (free)" },
  { id: "ling-3.0-flash-fin-free", name: "Ling 3.0 Flash Fin (free)" },
];

export function threadKey(symbol: string, timeframe: string): string {
  return `${(symbol || "").toUpperCase()}|${timeframe || "-"}`;
}

export function personaById(id: PersonaId | string | null | undefined) {
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[0];
}

/* ── thread persistence ─────────────────────────────────────────────── */

export async function loadThread(symbol: string, timeframe: string): Promise<CopilotThread | null> {
  const key = threadKey(symbol, timeframe);
  const threads = await getCopilotThreads();
  return threads.find((t) => t.key === key) ?? null;
}

export async function listRecentThreads(limit = 12): Promise<CopilotThread[]> {
  const threads = await getCopilotThreads();
  return threads.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

async function upsertThread(thread: CopilotThread): Promise<void> {
  const threads = await getCopilotThreads();
  const idx = threads.findIndex((t) => t.id === thread.id);
  if (idx >= 0) threads[idx] = thread;
  else threads.unshift(thread);
  await saveCopilotThreads(threads);
}

export async function clearThread(symbol: string, timeframe: string): Promise<void> {
  const key = threadKey(symbol, timeframe);
  const threads = await getCopilotThreads();
  const keep = threads.filter((t) => t.key !== key);
  await saveCopilotThreads(keep);
  const memory = await getCopilotMemory();
  if (memory[key]) {
    delete memory[key];
    await saveCopilotMemory(memory);
  }
}

/* ── rolling memory ─────────────────────────────────────────────────── */

export async function loadMemory(symbol: string, timeframe: string): Promise<CopilotMemory | null> {
  const memory = await getCopilotMemory();
  return memory[threadKey(symbol, timeframe)] ?? null;
}

function memoryBlock(memory: CopilotMemory | null): string {
  if (!memory || (!memory.bias && !memory.plan && !(memory.keyLevels?.length))) return "";
  const lines = ["===== PRIOR SESSION MEMORY (what you concluded before) ====="];
  if (memory.bias) lines.push(`Bias: ${memory.bias}`);
  if (memory.keyLevels?.length) lines.push(`Key levels: ${memory.keyLevels.join("; ")}`);
  if (memory.plan) lines.push(`Active plan: ${memory.plan}`);
  if (memory.notes?.length) lines.push(`Notes: ${memory.notes.slice(-5).join("; ")}`);
  lines.push("Stay consistent with this memory unless the fresh chart context contradicts it — if it does, say what changed.");
  lines.push("===== END MEMORY =====");
  return `\n\n${lines.join("\n")}`;
}

/**
 * Distill an assistant answer into compact memory. Cheap heuristic: keep the
 * last chunk of prose, capped, plus any lines that look like levels.
 */
function distillMemory(answer: string, prev: CopilotMemory | null): CopilotMemory {
  const levels: string[] = [];
  const levelLine = /^(?:key\s+)?levels?\s*:?\s*(.+)$/im;
  const m = answer.match(levelLine);
  if (m) levels.push(m[1].slice(0, 220));

  const tail = answer.trim().split(/\n{2,}/).slice(-2).join(" ").slice(0, 500);
  return {
    bias: prev?.bias,
    keyLevels: levels.length ? levels : prev?.keyLevels,
    plan: tail || prev?.plan,
    notes: prev?.notes,
    updatedAt: Date.now(),
  };
}

/* ── the main call ──────────────────────────────────────────────────── */

export interface AskOptions {
  symbol: string;
  timeframe: string;
  /** Canonical structured chart context (from GET_AI_READY_CONTEXT). */
  structuredContext: string | null;
  /** Extra context object handed to the server (enriched chart). */
  contextObject?: unknown;
  question: string;
  /** Include prior conversation turns (up to 12) for continuity. */
  withHistory?: boolean;
  onThreadUpdate?: (thread: CopilotThread) => void;
}

export async function askCopilot(opts: AskOptions): Promise<{ answer: string; model: string | null; thread: CopilotThread | null }> {
  const prefs = await getCopilotPrefs();
  const persona = personaById(prefs.personaId);
  const key = threadKey(opts.symbol, opts.timeframe);

  const history = opts.withHistory !== false ? (await loadThread(opts.symbol, opts.timeframe))?.messages.slice(-12) ?? [] : [];
  const memory = await loadMemory(opts.symbol, opts.timeframe);

  const contextBlock = opts.structuredContext
    ? `\n\n===== CURRENT CHART CONTEXT (canonical) =====\n${opts.structuredContext}\n===== END CONTEXT =====`
    : `\n\n===== CURRENT CHART CONTEXT =====\nNo active chart context available. Work from general knowledge and never fabricate prices.\n===== END CONTEXT =====`;

  const conversation = history.map((m) => ({ role: m.role, content: m.content }));
  conversation.push({
    role: "user" as const,
    content: `${opts.question}${memoryBlock(memory)}${contextBlock}`,
  });

  const result = await chatWithAI(
    conversation.map((m, i) => ({ ...m, timestamp: i })),
    persona.systemPrompt,
    8000,
    opts.contextObject,
    prefs.model || undefined
  );

  // Persist turn + memory (best effort — chat must survive storage failure).
  let thread: CopilotThread | null = null;
  try {
    const existing = await loadThread(opts.symbol, opts.timeframe);
    const userMsg: CopilotMessage = { id: `m${Date.now()}u`, role: "user", content: opts.question, at: Date.now(), personaId: persona.id };
    const botMsg: CopilotMessage = { id: `m${Date.now()}a`, role: "assistant", content: result.content, at: Date.now(), model: result.model ?? prefs.model ?? null, personaId: persona.id };
    thread = existing ?? {
      id: `t${Date.now()}`,
      key,
      symbol: opts.symbol.toUpperCase(),
      timeframe: opts.timeframe,
      title: `${opts.symbol.toUpperCase()} ${opts.timeframe}`,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    thread.messages = [...thread.messages, userMsg, botMsg].slice(-200);
    thread.updatedAt = Date.now();
    await upsertThread(thread);

    const mem = await getCopilotMemory();
    mem[key] = distillMemory(result.content, mem[key] ?? null);
    await saveCopilotMemory(mem);

    opts.onThreadUpdate?.(thread);
  } catch { /* storage may be unavailable */ }

  return { answer: result.content, model: result.model ?? prefs.model ?? null, thread };
}

export async function updateCopilotPrefs(patch: { personaId?: PersonaId; model?: string | null; autoAnalyzeOnSwitch?: boolean }): Promise<void> {
  await saveCopilotPrefs(patch);
}
