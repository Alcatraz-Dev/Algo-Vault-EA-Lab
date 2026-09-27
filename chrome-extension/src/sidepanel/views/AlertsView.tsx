/**
 * Alerts view — create and manage price alerts from the side panel.
 *
 * Backed by the same `/api/alerts` endpoints as the web dashboard, so alerts
 * created here trigger the user's normal Discord/Telegram/in-app pipelines.
 */
import React, { useState, useEffect, useCallback } from "react";
import { Bell, Plus, Trash2, Loader2, CheckCircle2 } from "lucide-react";
import { listAlerts, createAlert, deleteAlert } from "@/api/alerts";
import type { ExtensionAlert, AlertType } from "@/types/copilot";

interface AlertsViewProps {
  symbol: string;
  timeframe: string;
}

const ALERT_TYPES: Array<{ id: AlertType; label: string; needsPrice: boolean }> = [
  { id: "price_above", label: "Price above", needsPrice: true },
  { id: "price_below", label: "Price below", needsPrice: true },
  { id: "structure_bos", label: "Structure BOS", needsPrice: false },
  { id: "structure_choch", label: "Structure CHOCH", needsPrice: false },
  { id: "volatility_high", label: "Volatility spike", needsPrice: false },
];

export function AlertsView({ symbol, timeframe }: AlertsViewProps) {
  const [alerts, setAlerts] = useState<ExtensionAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<AlertType>("price_above");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setAlerts(await listAlerts());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Prefill the price input with the live price.
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "GET_AI_READY_CONTEXT" }, (resp) => {
      const enriched = resp?.enriched as { market?: { currentPrice?: number | null } } | undefined;
      const p = enriched?.market?.currentPrice;
      if (p != null && !price) setPrice(String(p));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const handleCreate = async () => {
    const target = parseFloat(price);
    const needsPrice = ALERT_TYPES.find((t) => t.id === type)?.needsPrice;
    if (needsPrice && (!Number.isFinite(target) || target <= 0)) {
      setError("Enter a valid target price.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await createAlert({
        symbol,
        type,
        targetPrice: needsPrice ? target : undefined,
        timeframe,
        message: note.trim() || undefined,
      });
      setNote("");
      setShowForm(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create alert");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteAlert(id);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete alert");
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-edge px-2.5 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
          Alerts · {symbol}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={refresh} className="rounded p-1 text-ink-mute hover:text-ink" title="Refresh">
            {loading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1 rounded bg-brand-500/20 px-2 py-1 text-[10px] font-semibold text-brand-400"
          >
            <Plus size={11} /> New
          </button>
        </div>
      </div>

      {showForm && (
        <div className="space-y-2 border-b border-edge bg-raised/60 p-3 animate-fade-in">
          <div className="grid grid-cols-2 gap-1.5">
            {ALERT_TYPES.map((t) => (
              <button
                key={t.id}
                onClick={() => setType(t.id)}
                className={`rounded border px-2 py-1.5 text-left text-[10px] ${
                  type === t.id ? "border-brand-500/50 bg-brand-500/10 text-brand-300" : "border-edge text-ink-mute hover:text-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {ALERT_TYPES.find((t) => t.id === type)?.needsPrice && (
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              type="number"
              placeholder="Target price"
              className="w-full rounded border border-edge bg-base px-2 py-1.5 font-mono text-[11px] text-ink outline-none"
            />
          )}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="w-full rounded border border-edge bg-base px-2 py-1.5 text-[11px] text-ink outline-none"
          />
          <button
            onClick={handleCreate}
            disabled={creating}
            className="flex w-full items-center justify-center gap-1.5 rounded bg-brand-500 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
          >
            {creating ? <Loader2 size={12} className="animate-spin" /> : <Bell size={12} />}
            {creating ? "Creating…" : `Create ${symbol} alert`}
          </button>
        </div>
      )}

      {error && <p className="border-b border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-[10px] text-rose-300">{error}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {alerts.length === 0 && !loading && (
          <p className="py-8 text-center text-[10px] text-ink-faint">
            No alerts yet. Create one to get notified on Discord / Telegram / in-app.
          </p>
        )}
        {alerts.map((a) => (
          <div key={a.id} className="mb-1.5 flex items-center gap-2 rounded-lg border border-edge bg-card px-2.5 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[11px] font-semibold text-ink">
                {a.symbol} <span className="font-sans font-normal text-ink-mute">· {a.type.replace(/_/g, " ")}</span>
                {a.targetPrice != null && <span className="text-brand-400"> @ {a.targetPrice}</span>}
              </p>
              <p className="truncate text-[9px] text-ink-faint">
                {a.timeframe} · {new Date(a.createdAt).toLocaleDateString()} {a.triggered ? "· triggered" : ""}
              </p>
            </div>
            <button onClick={() => handleDelete(a.id)} className="rounded p-1 text-ink-faint hover:text-rose-400" title="Delete alert">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
