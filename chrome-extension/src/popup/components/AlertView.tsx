/**
 * AlertView — popup view for creating and managing price alerts.
 *
 * Accessible from the overlay's Alert button (via OPEN_EXTENSION_VIEW →
 * "alerts"). Mirrors the side-panel AlertsView but fits the compact popup
 * width and shares the same BackButton / ui-kit primitives.
 */
import React, { useState, useEffect, useCallback } from "react";
import { Bell, Plus, Trash2, Loader2, RefreshCw, CheckCircle2 } from "lucide-react";
import { listAlerts, createAlert, deleteAlert } from "@/api/alerts";
import type { ExtensionAlert, AlertType } from "@/types/copilot";
import type { TradingViewContext } from "@/types";
import { BackButton, inputClass } from "./ui";

interface AlertViewProps {
  symbol: string | null;
  context: TradingViewContext | null;
  onBack: () => void;
}

const ALERT_TYPES: Array<{ id: AlertType; label: string; needsPrice: boolean }> = [
  { id: "price_above", label: "Price above", needsPrice: true },
  { id: "price_below", label: "Price below", needsPrice: true },
  { id: "structure_bos", label: "BOS break", needsPrice: false },
  { id: "structure_choch", label: "CHoCH break", needsPrice: false },
  { id: "volatility_high", label: "Volatility spike", needsPrice: false },
];

export function AlertView({ symbol, context, onBack }: AlertViewProps) {
  const [alerts, setAlerts] = useState<ExtensionAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<AlertType>("price_above");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const displaySymbol = context?.symbol || symbol || "—";
  const tf = context?.timeframe || "H1";

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAlerts(await listAlerts());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Pre-fill price from the live market context or the extension's enriched data.
  useEffect(() => {
    const livePrice = context?.price;
    if (livePrice != null && !price) {
      setPrice(String(livePrice));
      return;
    }
    // Fallback: ask the SW for the latest enriched price.
    chrome.runtime.sendMessage({ type: "GET_AI_READY_CONTEXT" }, (resp) => {
      const enriched = resp?.enriched as { market?: { currentPrice?: number | null } } | undefined;
      const p = enriched?.market?.currentPrice;
      if (p != null && !price) setPrice(String(p));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const needsPrice = ALERT_TYPES.find((t) => t.id === type)?.needsPrice ?? true;

  const handleCreate = async () => {
    const target = parseFloat(price);
    if (needsPrice && (!Number.isFinite(target) || target <= 0)) {
      setError("Enter a valid target price.");
      return;
    }
    setCreating(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await createAlert({
        symbol: displaySymbol,
        type,
        targetPrice: needsPrice ? target : undefined,
        timeframe: tf,
        message: note.trim() || undefined,
      });
      setNote("");
      setShowForm(false);
      setSuccessMsg(`Alert created for ${displaySymbol}`);
      await refresh();
      setTimeout(() => setSuccessMsg(null), 3000);
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
      {/* header */}
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <div className="flex items-center gap-2">
          <BackButton onClick={onBack} />
          <Bell size={13} className="text-brand-400" />
          <span className="text-xs font-semibold text-ink">
            Alerts
            <span className="ml-1.5 font-mono text-[10px] text-brand-400">
              {displaySymbol} · {tf}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={refresh}
            className="rounded p-1 text-ink-mute transition-colors hover:text-ink"
            title="Refresh"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
          <button
            onClick={() => { setShowForm((v) => !v); setError(null); }}
            className="flex items-center gap-1 rounded bg-brand-500/20 px-2 py-1 text-[10px] font-semibold text-brand-400 transition-colors hover:bg-brand-500/30"
          >
            <Plus size={11} />
            New
          </button>
        </div>
      </div>

      {/* success banner */}
      {successMsg && (
        <div className="flex items-center gap-1.5 border-b border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 animate-fade-in">
          <CheckCircle2 size={11} className="shrink-0 text-emerald-400" />
          <p className="text-[10px] text-emerald-300">{successMsg}</p>
        </div>
      )}

      {/* error banner */}
      {error && (
        <div className="border-b border-rose-500/20 bg-rose-500/10 px-3 py-1.5">
          <p className="text-[10px] text-rose-300">{error}</p>
        </div>
      )}

      {/* create form */}
      {showForm && (
        <div className="space-y-2 border-b border-edge bg-raised/60 p-3 animate-fade-in">
          <div className="grid grid-cols-2 gap-1.5">
            {ALERT_TYPES.map((t) => (
              <button
                key={t.id}
                onClick={() => setType(t.id)}
                className={`rounded border px-2 py-1.5 text-left text-[10px] transition-colors ${
                  type === t.id
                    ? "border-brand-500/50 bg-brand-500/10 text-brand-300"
                    : "border-edge text-ink-mute hover:text-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {needsPrice && (
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              type="number"
              step="any"
              placeholder="Target price"
              className={inputClass}
            />
          )}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className={inputClass}
          />
          <button
            onClick={handleCreate}
            disabled={creating}
            className="flex w-full items-center justify-center gap-1.5 rounded bg-brand-500 py-1.5 text-[11px] font-semibold text-white transition-opacity disabled:opacity-40 hover:bg-brand-400"
          >
            {creating ? <Loader2 size={12} className="animate-spin" /> : <Bell size={12} />}
            {creating ? "Creating…" : `Create ${displaySymbol} alert`}
          </button>
        </div>
      )}

      {/* alerts list */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading && (
          <div className="flex items-center justify-center py-10">
            <Loader2 size={18} className="animate-spin text-brand-400" />
          </div>
        )}
        {!loading && alerts.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Bell size={24} className="text-ink-faint" />
            <p className="text-[10px] text-ink-faint">
              No alerts yet. Create one to get notified on Discord / Telegram.
            </p>
            <button
              onClick={() => setShowForm(true)}
              className="mt-1 rounded bg-brand-500/20 px-3 py-1.5 text-[10px] font-semibold text-brand-400 hover:bg-brand-500/30"
            >
              + New alert
            </button>
          </div>
        )}
        {alerts.map((a) => (
          <div
            key={a.id}
            className="mb-1.5 flex items-center gap-2 rounded-lg border border-edge bg-card px-2.5 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[11px] font-semibold text-ink">
                {a.symbol}{" "}
                <span className="font-sans font-normal text-ink-mute">
                  · {a.type.replace(/_/g, " ")}
                </span>
                {a.targetPrice != null && (
                  <span className="text-brand-400"> @ {a.targetPrice}</span>
                )}
              </p>
              <p className="mt-0.5 truncate text-[9px] text-ink-faint">
                {a.timeframe} · {new Date(a.createdAt).toLocaleDateString()}
                {a.triggered ? " · ✓ triggered" : ""}
              </p>
            </div>
            <button
              onClick={() => handleDelete(a.id)}
              className="rounded p-1 text-ink-faint transition-colors hover:text-rose-400"
              title="Delete alert"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
