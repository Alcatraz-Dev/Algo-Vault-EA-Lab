import React, { useState, useEffect } from "react";
import { generateStrategy, listStrategies, handoffStrategyToBacktest } from "@/api/pro";
import type { GeneratedStrategy } from "@/types/pro";
import { CpuIcon, SparklesIcon, CopyIcon, CheckIcon, ExternalLinkIcon, AlertTriangleIcon, BookmarkIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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

  const handleHandoff = async (id: string) => {
    try {
      const res = await handoffStrategyToBacktest(id, symbol || "ALL", timeframe || "1H");
      if (res.url) window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backtest handoff failed");
    }
  };

  return (
    <div className="flex h-full flex-col space-y-3 overflow-y-auto bg-background p-3 text-xs text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-2">
        <div className="flex items-center space-x-2">
          <CpuIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold tracking-wide">AI Strategy Studio</span>
        </div>
        <div className="flex rounded-lg border border-border bg-secondary p-0.5">
          <button
            type="button"
            onClick={() => setActiveTab("create")}
            className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 ${
              activeTab === "create"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("library")}
            className={`flex items-center space-x-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 ${
              activeTab === "library"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <BookmarkIcon className="h-2.5 w-2.5" />
            <span>Library ({library.length})</span>
          </button>
        </div>
      </div>

      {activeTab === "create" ? (
        <div className="space-y-3">
          <form onSubmit={handleGenerate} className="space-y-2">
            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase text-muted-foreground">
                Strategy specification & rules
              </label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. ICT Silver Bullet setup on 5m timeframe. Enter long on 15m bullish FVG after liquidity sweep during NY session open. Stop below swing low, TP at 1:2.5 RR..."
                className="min-h-[80px] resize-none text-[11px]"
              />
            </div>

            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Target: {symbol || "ALL"} ({timeframe || "1H"})</span>
              <Button
                type="submit"
                variant="brand"
                size="sm"
                disabled={loading || !description.trim()}
                className="gap-1.5"
              >
                <SparklesIcon className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                <span>{loading ? "Generating Strategy..." : "Build Strategy"}</span>
              </Button>
            </div>
          </form>

          {error && (
            <Alert variant="destructive" className="py-2">
              <AlertTriangleIcon />
              <AlertDescription className="text-[11px]">{error}</AlertDescription>
            </Alert>
          )}

          {currentStrategy && (
            <div className="space-y-2.5 rounded-xl border border-border bg-card p-3">
              <div className="flex items-center justify-between border-b border-border pb-1.5">
                <div>
                  <h4 className="text-xs font-semibold text-foreground">{currentStrategy.name}</h4>
                  <p className="text-[10px] text-muted-foreground">{currentStrategy.description}</p>
                </div>
                <div className="flex items-center space-x-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => copyCode(currentStrategy.code)}
                    aria-label="Copy code"
                    className="px-2"
                  >
                    {copied ? (
                      <CheckIcon className="h-3 w-3 text-positive" />
                    ) : (
                      <CopyIcon className="h-3 w-3 text-muted-foreground" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={() => handleHandoff(currentStrategy.id)}
                    className="gap-1.5 text-[10px]"
                  >
                    <ExternalLinkIcon className="h-3 w-3" />
                    <span>Backtest Engine</span>
                  </Button>
                </div>
              </div>

              {currentStrategy.spec && (
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-secondary/50 p-2 text-[10px]">
                  <div>
                    <span className="block font-medium uppercase text-muted-foreground">Entry Rules</span>
                    <ul className="list-inside list-disc text-positive">
                      {currentStrategy.spec.entry?.conditions?.map((c, i) => (
                        <li key={i} className="truncate">{c}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <span className="block font-medium uppercase text-muted-foreground">Exit Rules</span>
                    <ul className="list-inside list-disc text-negative">
                      {currentStrategy.spec.exit?.conditions?.map((c, i) => (
                        <li key={i} className="truncate">{c}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              <div className="relative">
                <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-secondary p-2.5 font-mono text-[10px] text-foreground">
                  {currentStrategy.code}
                </pre>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {library.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              No saved strategies found in your library yet.
            </div>
          ) : (
            library.map((strat) => (
              <div
                key={strat.id}
                className="space-y-1.5 rounded-xl border border-border bg-card p-2.5 transition-colors hover:border-foreground/20"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className="font-semibold text-foreground">{strat.name}</span>
                    <p className="line-clamp-1 text-[10px] text-muted-foreground">{strat.description}</p>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <button
                      type="button"
                      onClick={() => copyCode(strat.code)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
                      title="Copy Code"
                    >
                      <CopyIcon className="h-3.5 w-3.5" />
                    </button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleHandoff(strat.id)}
                      className="h-6 gap-1 px-2 text-[10px]"
                    >
                      <ExternalLinkIcon className="h-3 w-3" />
                      <span>Backtest</span>
                    </Button>
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
