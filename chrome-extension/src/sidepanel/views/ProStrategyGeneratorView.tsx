import React, { useState, useEffect } from "react";
import { generateStrategy, listStrategies, handoffStrategyToBacktest } from "@/api/pro";
import type { GeneratedStrategy } from "@/types/pro";
import { CpuIcon, SparklesIcon, CopyIcon, CheckIcon, ExternalLinkIcon, AlertTriangleIcon, BookmarkIcon } from "lucide-react";

interface ProStrategyGeneratorViewProps {
  symbol: string;
  timeframe: string;
}

export const ProStrategyGeneratorView: React.FC<ProStrategyGeneratorViewProps> = ({
  symbol,
  timeframe,
}) => {
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStrategy, setCurrentStrategy] = useState<GeneratedStrategy | null>(null);
  const [library, setLibrary] = useState<GeneratedStrategy[]>([]);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"create" | "library">("create");

  useEffect(() => {
    loadLibrary();
  }, []);

  const loadLibrary = async () => {
    try {
      const list = await listStrategies();
      setLibrary(list || []);
    } catch {
      // Ignore background load errors
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await generateStrategy({
        description,
        symbolScope: symbol || "ALL",
        timeframe: timeframe || "1H",
      });
      setCurrentStrategy(res);
      await loadLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate strategy");
    } finally {
      setLoading(false);
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleHandoff = async (strategyId: string) => {
    try {
      const res = await handoffStrategyToBacktest(strategyId, symbol || "BTCUSD", timeframe || "1H");
      if (res.url) {
        window.open(res.url, "_blank");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backtest handoff failed");
    }
  };

  return (
    <div className="flex flex-col h-full bg-base text-ink text-xs p-3 space-y-3 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-edge/60 pb-2">
        <div className="flex items-center space-x-2">
          <CpuIcon className="w-4 h-4 text-brand-400" />
          <span className="font-semibold text-sm tracking-wide">AI Strategy Studio</span>
        </div>
        <div className="flex bg-raised rounded p-0.5 border border-edge/60">
          <button
            onClick={() => setActiveTab("create")}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              activeTab === "create" ? "bg-brand-500 text-white" : "text-ink-mute hover:text-ink"
            }`}
          >
            Create
          </button>
          <button
            onClick={() => setActiveTab("library")}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors flex items-center space-x-1 ${
              activeTab === "library" ? "bg-brand-500 text-white" : "text-ink-mute hover:text-ink"
            }`}
          >
            <BookmarkIcon className="w-2.5 h-2.5" />
            <span>Library ({library.length})</span>
          </button>
        </div>
      </div>

      {activeTab === "create" ? (
        <div className="space-y-3">
          <form onSubmit={handleGenerate} className="space-y-2">
            <div>
              <label className="block text-ink-mute text-[10px] font-medium uppercase mb-1">
                Strategy specification & rules
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. ICT Silver Bullet setup on 5m timeframe. Enter long on 15m bullish FVG after liquidity sweep during NY session open. Stop below swing low, TP at 1:2.5 RR..."
                className="w-full bg-raised border border-edge rounded p-2.5 text-ink placeholder-ink-mute/50 focus:outline-none focus:border-brand-500 min-h-[80px] resize-none text-xs"
              />
            </div>

            <div className="flex justify-between items-center text-[10px] text-ink-mute">
              <span>Target: {symbol || "ALL"} ({timeframe || "1H"})</span>
              <button
                type="submit"
                disabled={loading || !description.trim()}
                className="bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-white font-medium px-3 py-1.5 rounded flex items-center space-x-1.5 transition-colors"
              >
                <SparklesIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                <span>{loading ? "Generating Strategy..." : "Build Strategy"}</span>
              </button>
            </div>
          </form>

          {error && (
            <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded flex items-center space-x-2">
              <AlertTriangleIcon className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {currentStrategy && (
            <div className="bg-card border border-edge rounded-lg p-3 space-y-2.5 animate-fade-in">
              <div className="flex items-center justify-between border-b border-edge/40 pb-1.5">
                <div>
                  <h4 className="font-semibold text-ink text-xs">{currentStrategy.name}</h4>
                  <p className="text-[10px] text-ink-mute">{currentStrategy.description}</p>
                </div>
                <div className="flex items-center space-x-1.5">
                  <button
                    onClick={() => copyCode(currentStrategy.code)}
                    className="bg-raised border border-edge hover:border-brand-500/50 px-2 py-1 rounded text-[10px] text-ink flex items-center space-x-1 transition-colors"
                  >
                    {copied ? (
                      <CheckIcon className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <CopyIcon className="w-3 h-3 text-ink-mute" />
                    )}
                  </button>
                  <button
                    onClick={() => handleHandoff(currentStrategy.id)}
                    className="bg-brand-500 hover:bg-brand-400 text-white px-2.5 py-1 rounded text-[10px] font-medium flex items-center space-x-1 transition-colors"
                  >
                    <ExternalLinkIcon className="w-3 h-3" />
                    <span>Backtest Engine</span>
                  </button>
                </div>
              </div>

              {currentStrategy.spec && (
                <div className="grid grid-cols-2 gap-2 text-[10px] bg-raised/50 p-2 rounded border border-edge/40">
                  <div>
                    <span className="text-ink-mute block uppercase font-medium">Entry Rules</span>
                    <ul className="list-disc list-inside text-emerald-400/90">
                      {currentStrategy.spec.entry?.conditions?.map((c, i) => (
                        <li key={i} className="truncate">{c}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <span className="text-ink-mute block uppercase font-medium">Exit Rules</span>
                    <ul className="list-disc list-inside text-rose-400/90">
                      {currentStrategy.spec.exit?.conditions?.map((c, i) => (
                        <li key={i} className="truncate">{c}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              <div className="relative">
                <pre className="bg-raised border border-edge/80 rounded p-2.5 text-[10px] font-mono text-emerald-300 max-h-[180px] overflow-auto whitespace-pre-wrap">
                  {currentStrategy.code}
                </pre>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {library.length === 0 ? (
            <div className="text-center py-8 text-ink-mute">
              No saved strategies found in your library yet.
            </div>
          ) : (
            library.map((strat) => (
              <div
                key={strat.id}
                className="bg-card border border-edge rounded p-2.5 space-y-1.5 hover:border-edge/80"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <span className="font-semibold text-ink">{strat.name}</span>
                    <p className="text-[10px] text-ink-mute line-clamp-1">{strat.description}</p>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => copyCode(strat.code)}
                      className="p-1 hover:bg-raised rounded text-ink-mute hover:text-ink"
                      title="Copy Code"
                    >
                      <CopyIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleHandoff(strat.id)}
                      className="px-2 py-0.5 bg-brand-500/20 text-brand-400 hover:bg-brand-500/30 rounded text-[10px] font-medium flex items-center space-x-1"
                    >
                      <ExternalLinkIcon className="w-3 h-3" />
                      <span>Backtest</span>
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
