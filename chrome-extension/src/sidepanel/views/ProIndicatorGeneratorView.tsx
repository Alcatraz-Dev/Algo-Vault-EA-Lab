import React, { useState, useEffect } from "react";
import { generateIndicator, listIndicators, archiveIndicator } from "@/api/pro";
import type { GeneratedIndicator } from "@/types/pro";
import { CodeIcon, SparklesIcon, CopyIcon, CheckIcon, Trash2Icon, AlertTriangleIcon, BookmarkIcon } from "lucide-react";

interface ProIndicatorGeneratorViewProps {
  symbol: string;
  timeframe: string;
}

export const ProIndicatorGeneratorView: React.FC<ProIndicatorGeneratorViewProps> = ({
  symbol,
  timeframe,
}) => {
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentIndicator, setCurrentIndicator] = useState<GeneratedIndicator | null>(null);
  const [library, setLibrary] = useState<GeneratedIndicator[]>([]);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"generate" | "library">("generate");

  useEffect(() => {
    loadLibrary();
  }, []);

  const loadLibrary = async () => {
    try {
      const list = await listIndicators();
      setLibrary(list || []);
    } catch {
      // Library list is secondary, silent fail ok
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await generateIndicator({
        description,
        symbolScope: symbol || "ALL",
        timeframe: timeframe || "1H",
      });
      setCurrentIndicator(res);
      await loadLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate indicator");
    } finally {
      setLoading(false);
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleArchive = async (id: string) => {
    try {
      await archiveIndicator(id);
      setLibrary((prev) => prev.filter((item) => item.id !== id));
      if (currentIndicator?.id === id) {
        setCurrentIndicator(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-base text-ink text-xs p-3 space-y-3 overflow-y-auto">
      {/* View Header */}
      <div className="flex items-center justify-between border-b border-edge/60 pb-2">
        <div className="flex items-center space-x-2">
          <CodeIcon className="w-4 h-4 text-brand-400" />
          <span className="font-semibold text-sm tracking-wide">AI Pine Indicator Studio</span>
        </div>
        <div className="flex bg-raised rounded p-0.5 border border-edge/60">
          <button
            onClick={() => setActiveTab("generate")}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              activeTab === "generate" ? "bg-brand-500 text-white" : "text-ink-mute hover:text-ink"
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

      {activeTab === "generate" ? (
        <div className="space-y-3">
          <form onSubmit={handleGenerate} className="space-y-2">
            <div>
              <label className="block text-ink-mute text-[10px] font-medium uppercase mb-1">
                Describe desired TradingView indicator (Pine v5/v6)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Multi-timeframe EMA cloud with RSI divergence signals and Fair Value Gap highlighting..."
                className="w-full bg-raised border border-edge rounded p-2.5 text-ink placeholder-ink-mute/50 focus:outline-none focus:border-brand-500 min-h-[70px] resize-none text-xs"
              />
            </div>

            <div className="flex justify-between items-center text-[10px] text-ink-mute">
              <span>Scope: {symbol || "Current Symbol"} ({timeframe || "1H"})</span>
              <button
                type="submit"
                disabled={loading || !description.trim()}
                className="bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-white font-medium px-3 py-1.5 rounded flex items-center space-x-1.5 transition-colors"
              >
                <SparklesIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                <span>{loading ? "Generating..." : "Generate Pine Script"}</span>
              </button>
            </div>
          </form>

          {error && (
            <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded flex items-center space-x-2">
              <AlertTriangleIcon className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {currentIndicator && (
            <div className="bg-card border border-edge rounded-lg p-3 space-y-2.5 animate-fade-in">
              <div className="flex items-center justify-between border-b border-edge/40 pb-1.5">
                <div>
                  <h4 className="font-semibold text-ink text-xs">{currentIndicator.name}</h4>
                  <p className="text-[10px] text-ink-mute">{currentIndicator.description}</p>
                </div>
                <button
                  onClick={() => copyCode(currentIndicator.code)}
                  className="bg-raised border border-edge hover:border-brand-500/50 px-2 py-1 rounded text-[10px] text-ink flex items-center space-x-1 transition-colors"
                >
                  {copied ? (
                    <>
                      <CheckIcon className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <CopyIcon className="w-3 h-3 text-ink-mute" />
                      <span>Copy Pine Code</span>
                    </>
                  )}
                </button>
              </div>

              {currentIndicator.warnings && currentIndicator.warnings.length > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] p-2 rounded">
                  <strong className="block mb-0.5">Notes & Warnings:</strong>
                  <ul className="list-disc list-inside space-y-0.5">
                    {currentIndicator.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="relative">
                <pre className="bg-raised border border-edge/80 rounded p-2.5 text-[10px] font-mono text-emerald-300 max-h-[200px] overflow-auto whitespace-pre-wrap">
                  {currentIndicator.code}
                </pre>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {library.length === 0 ? (
            <div className="text-center py-8 text-ink-mute">
              No saved indicators found in your library yet.
            </div>
          ) : (
            library.map((ind) => (
              <div
                key={ind.id}
                className="bg-card border border-edge rounded p-2.5 space-y-1.5 hover:border-edge/80"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <span className="font-semibold text-ink">{ind.name}</span>
                    <p className="text-[10px] text-ink-mute line-clamp-1">{ind.description}</p>
                  </div>
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => copyCode(ind.code)}
                      className="p-1 hover:bg-raised rounded text-ink-mute hover:text-ink"
                      title="Copy Code"
                    >
                      <CopyIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleArchive(ind.id)}
                      className="p-1 hover:bg-raised rounded text-ink-mute hover:text-rose-400"
                      title="Archive"
                    >
                      <Trash2Icon className="w-3.5 h-3.5" />
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
