import React, { useState, useEffect } from "react";
import { generateIndicator, listIndicators, archiveIndicator } from "@/api/pro";
import type { GeneratedIndicator } from "@/types/pro";
import { CodeIcon, SparklesIcon, CopyIcon, CheckIcon, Trash2Icon, AlertTriangleIcon, BookmarkIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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
    <div className="flex h-full flex-col space-y-3 overflow-y-auto bg-background p-3 text-xs text-foreground">
      {/* View Header */}
      <div className="flex items-center justify-between border-b border-border pb-2">
        <div className="flex items-center space-x-2">
          <CodeIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold tracking-wide">AI Pine Indicator Studio</span>
        </div>
        <div className="flex rounded-lg border border-border bg-secondary p-0.5">
          <button
            type="button"
            onClick={() => setActiveTab("generate")}
            className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 ${
              activeTab === "generate"
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

      {activeTab === "generate" ? (
        <div className="space-y-3">
          <form onSubmit={handleGenerate} className="space-y-2">
            <div>
              <label className="mb-1 block text-[10px] font-medium uppercase text-muted-foreground">
                Describe desired TradingView indicator (Pine v5/v6)
              </label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Multi-timeframe EMA cloud with RSI divergence signals and Fair Value Gap highlighting..."
                className="min-h-[70px] resize-none text-[11px]"
              />
            </div>

            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Scope: {symbol || "Current Symbol"} ({timeframe || "1H"})</span>
              <Button
                type="submit"
                variant="brand"
                size="sm"
                disabled={loading || !description.trim()}
                className="gap-1.5"
              >
                <SparklesIcon className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                <span>{loading ? "Generating..." : "Generate Pine Script"}</span>
              </Button>
            </div>
          </form>

          {error && (
            <Alert variant="destructive" className="py-2">
              <AlertTriangleIcon />
              <AlertDescription className="text-[11px]">{error}</AlertDescription>
            </Alert>
          )}

          {currentIndicator && (
            <div className="space-y-2.5 rounded-xl border border-border bg-card p-3">
              <div className="flex items-center justify-between border-b border-border pb-1.5">
                <div>
                  <h4 className="text-xs font-semibold text-foreground">{currentIndicator.name}</h4>
                  <p className="text-[10px] text-muted-foreground">{currentIndicator.description}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copyCode(currentIndicator.code)}
                  className="gap-1.5 text-[10px]"
                >
                  {copied ? (
                    <>
                      <CheckIcon className="h-3 w-3 text-positive" />
                      <span className="text-positive">Copied</span>
                    </>
                  ) : (
                    <>
                      <CopyIcon className="h-3 w-3 text-muted-foreground" />
                      <span>Copy Pine Code</span>
                    </>
                  )}
                </Button>
              </div>

              {currentIndicator.warnings && currentIndicator.warnings.length > 0 && (
                <div className="rounded-lg border border-warning/30 bg-warning/10 p-2 text-[10px] text-warning">
                  <strong className="mb-0.5 block">Notes & Warnings:</strong>
                  <ul className="list-inside list-disc space-y-0.5">
                    {currentIndicator.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="relative">
                <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-secondary p-2.5 font-mono text-[10px] text-foreground">
                  {currentIndicator.code}
                </pre>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {library.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              No saved indicators found in your library yet.
            </div>
          ) : (
            library.map((ind) => (
              <div
                key={ind.id}
                className="space-y-1.5 rounded-xl border border-border bg-card p-2.5 transition-colors hover:border-foreground/20"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className="font-semibold text-foreground">{ind.name}</span>
                    <p className="line-clamp-1 text-[10px] text-muted-foreground">{ind.description}</p>
                  </div>
                  <div className="flex items-center space-x-1">
                    <button
                      type="button"
                      onClick={() => copyCode(ind.code)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
                      title="Copy Code"
                    >
                      <CopyIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleArchive(ind.id)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-negative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
                      title="Archive"
                    >
                      <Trash2Icon className="h-3.5 w-3.5" />
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
