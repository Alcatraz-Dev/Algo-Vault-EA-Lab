import React, { useState, useEffect } from "react";
import {
  BarChart3, Brain, Shield, Target, Play, Settings, Wifi, User,
  Layers, ClipboardList, Cpu,
} from "lucide-react";
import { getAlgoVaultUrl } from "@/config/environment";
import type { TradingViewContext, ViewMode } from "@/types";
import { symbolDisplayName } from "@/utils/helpers";
import { getUser } from "@/storage/storage";
import type { MarketContext } from "@/types/market-context";

interface MainViewProps {
  symbol: string | null;
  context: TradingViewContext | null;
  isHealthy: boolean;
  gatewayConnected: boolean;
  onNavigate: (view: ViewMode) => void;
  onSelectSymbol: (s: string) => void;
  onStrategyLab: () => void;
  onBacktest: () => void;
  marketContext?: MarketContext | null;
}

export function MainView({
  symbol, context, gatewayConnected, onNavigate,
  onSelectSymbol, onStrategyLab, onBacktest, marketContext,
}: MainViewProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(symbol || "");
  const [user, setUser] = useState<Record<string, unknown> | null>(null);

  useEffect(() => { getUser().then(setUser); }, []);

  const handleSymbolSubmit = () => {
    const val = inputValue.trim().toUpperCase();
    if (val) onSelectSymbol(val);
    setEditing(false);
  };

  const handleActionClick = (action: string, view: ViewMode) => {
    if (action === "strategy-lab") { onStrategyLab(); return; }
    if (action === "backtest") { onBacktest(); return; }
    if (action === "optimize") {
      const base = context?.symbol || symbol || "";
      const tf = context?.timeframe || "H1";
      window.open(`${getAlgoVaultUrl()}/strategy-lab?symbol=${base}&timeframe=${tf}`, "_blank");
      return;
    }
    onNavigate(view);
  };

  const mc = marketContext;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#8888aa] uppercase tracking-wider">Symbol</span>
          {editing ? (
            <input
              autoFocus value={inputValue || ""} onChange={(e) => setInputValue(e.target.value)}
              onBlur={handleSymbolSubmit}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSymbolSubmit();
                if (e.key === "Escape") { setInputValue(symbol || ""); setEditing(false); }
              }}
              className="bg-white/5 border border-violet-500/30 rounded px-2 py-0.5 text-sm text-[#f0f0f5] outline-none w-28 font-mono"
            />
          ) : (
            <button onClick={() => { setInputValue(symbol || ""); setEditing(true); }}
              className="text-sm font-mono text-violet-400 hover:text-violet-300 transition-colors">
              {symbolDisplayName(symbol)}
            </button>
          )}
          {context?.timeframe && <span className="text-[10px] text-[#8888aa] ml-auto">{context.timeframe}</span>}
          {mc?.currentPrice != null ? (
            <span className="text-[10px] text-[#f0f0f5] font-mono">{mc.currentPrice.toFixed(mc.currentPrice >= 1000 ? 1 : mc.currentPrice >= 100 ? 2 : 4)}</span>
          ) : context?.price != null && (
            <span className="text-[10px] text-[#f0f0f5] font-mono">
              {context.price.toFixed(context.price >= 1000 ? 1 : context.price >= 100 ? 2 : 4)}
            </span>
          )}
          {mc?.status === "ready" && <span className="text-[9px] text-emerald-400">● Live</span>}
        </div>
      </div>

      {mc?.status === "ready" && (
        <div className="px-3 py-2 border-b border-white/5 space-y-1">
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-[#8888aa]">Trend</span>
            <span className={`text-[10px] font-semibold ${mc.trend.direction === "bullish" ? "text-emerald-400" : mc.trend.direction === "bearish" ? "text-rose-400" : "text-[#8888aa]"}`}>
              {mc.trend.direction.toUpperCase()}
            </span>
            <span className="text-[10px] text-[#8888aa]">|</span>
            <span className="text-[10px] text-[#8888aa]">Regime</span>
            <span className="text-[10px] text-[#f0f0f5]">{mc.marketRegime.regime.replace(/_/g, " ")}</span>
            <span className="text-[10px] text-[#8888aa]">|</span>
            <span className="text-[10px] text-[#8888aa]">Score</span>
            <span className={`text-[10px] font-mono ${mc.score.bias === "bullish" ? "text-emerald-400" : mc.score.bias === "bearish" ? "text-rose-400" : "text-[#8888aa]"}`}>
              {mc.score.total}/{mc.score.bias}
            </span>
          </div>
          {mc.mtfAlignment.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[#8888aa]">MTF:</span>
              {mc.mtfAlignment.map((m, i) => (
                <span key={i} className={`text-[9px] px-1 rounded font-mono ${m.bias === "bullish" ? "bg-emerald-500/10 text-emerald-400" : m.bias === "bearish" ? "bg-rose-500/10 text-rose-400" : "bg-white/5 text-[#8888aa]"}`}>
                  {m.timeframe}:{m.bias}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 p-3 grid grid-cols-2 gap-2">
        <button onClick={() => handleActionClick("", "analysis")}
          className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-violet-500/20 transition-all group">
          <span className="text-violet-400 opacity-70 group-hover:opacity-100 transition-opacity"><BarChart3 size={18} /></span>
          <span className="text-[11px] text-[#8888aa] group-hover:text-[#f0f0f5] transition-colors">Chart Intelligence</span>
        </button>
        <button onClick={() => handleActionClick("", "ai-copilot")}
          className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-violet-500/20 transition-all group">
          <span className="text-violet-400 opacity-70 group-hover:opacity-100 transition-opacity"><Brain size={18} /></span>
          <span className="text-[11px] text-[#8888aa] group-hover:text-[#f0f0f5] transition-colors">AI Copilot</span>
        </button>
        <button onClick={() => handleActionClick("strategy-lab", "main")}
          className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-violet-500/20 transition-all group">
          <span className="text-violet-400 opacity-70 group-hover:opacity-100 transition-opacity"><Layers size={18} /></span>
          <span className="text-[11px] text-[#8888aa] group-hover:text-[#f0f0f5] transition-colors">Strategy Lab</span>
        </button>
        <button onClick={() => handleActionClick("backtest", "main")}
          className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-violet-500/20 transition-all group">
          <span className="text-violet-400 opacity-70 group-hover:opacity-100 transition-opacity"><ClipboardList size={18} /></span>
          <span className="text-[11px] text-[#8888aa] group-hover:text-[#f0f0f5] transition-colors">Backtest</span>
        </button>
        <button onClick={() => handleActionClick("optimize", "main")}
          className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-violet-500/20 transition-all group">
          <span className="text-violet-400 opacity-70 group-hover:opacity-100 transition-opacity"><Cpu size={18} /></span>
          <span className="text-[11px] text-[#8888aa] group-hover:text-[#f0f0f5] transition-colors">Optimize</span>
        </button>
        <button onClick={() => handleActionClick("", "risk")}
          className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-violet-500/20 transition-all group">
          <span className="text-violet-400 opacity-70 group-hover:opacity-100 transition-opacity"><Shield size={18} /></span>
          <span className="text-[11px] text-[#8888aa] group-hover:text-[#f0f0f5] transition-colors">Risk Analysis</span>
        </button>
        <button onClick={() => handleActionClick("", "signal")}
          className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-violet-500/20 transition-all group">
          <span className="text-violet-400 opacity-70 group-hover:opacity-100 transition-opacity"><Target size={18} /></span>
          <span className="text-[11px] text-[#8888aa] group-hover:text-[#f0f0f5] transition-colors">Create Signal</span>
        </button>
        <button onClick={() => handleActionClick("", "execute")}
          className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-violet-500/20 transition-all group">
          <span className="text-violet-400 opacity-70 group-hover:opacity-100 transition-opacity"><Play size={18} /></span>
          <span className="text-[11px] text-[#8888aa] group-hover:text-[#f0f0f5] transition-colors">Execute</span>
        </button>
      </div>

      <div className="px-3 py-2 border-t border-white/5 flex items-center justify-between">
        <button onClick={() => onNavigate("settings")}
          className="flex items-center gap-1.5 text-[10px] text-[#8888aa] hover:text-[#f0f0f5] transition-colors">
          <Settings size={12} /> Settings
        </button>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Wifi size={10} className={gatewayConnected ? "text-emerald-400" : "text-neutral-500"} />
            <span className="text-[10px] text-[#8888aa]">{gatewayConnected ? "Gateway" : "Offline"}</span>
          </div>
          <div className="flex items-center gap-1">
            <User size={10} className={user ? "text-emerald-400" : "text-[#8888aa]"} />
            <span className={`text-[10px] ${user ? "text-emerald-400" : "text-[#8888aa]"}`}>
              {user ? (user.email as string || user.displayName as string || "Connected") : "Not connected"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
