"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  HelpCircle,
  Sparkles,
  GitBranch,
  Play,
  SlidersHorizontal,
  Bot,
  Layers,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Zap,
  Info,
} from "lucide-react";

interface GuideStep {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  content: string;
  tips: string[];
}

const GUIDE_STEPS: GuideStep[] = [
  {
    title: "Welcome to Workflow Studio",
    subtitle: "Build, test, and deploy automated trading strategies without writing code.",
    icon: <Sparkles className="w-8 h-8 text-blue-500" />,
    content:
      "Workflow Studio provides a visual DAG (Directed Acyclic Graph) canvas powered by React Flow. You can chain market data triggers, technical indicators, risk filters, AI decision routers, and alert channels.",
    tips: [
      "Drag nodes from the left Library panel onto the central canvas.",
      "Connect output handles (right dot) to input handles (left dot) to build logical flow.",
      "Use the bottom-left controls to zoom, center, or toggle minimap view.",
    ],
  },
  {
    title: "Configuring Node Parameters",
    subtitle: "Customize indicators, symbols, timeframes, and thresholds.",
    icon: <SlidersHorizontal className="w-8 h-8 text-amber-500" />,
    content:
      "Clicking any node on the canvas opens the Inspector panel on the right. Here you can edit custom labels, symbols (e.g. XAUUSD), timeframes (M5, H1), indicator periods (RSI period 14, EMA 200), and logic conditions.",
    tips: [
      "Collapse or expand parameter sections to keep your view tidy.",
      "Toggle node state (Enable/Disable) directly from the inspector.",
      "Check server-side node schema validation directly inside the details section.",
    ],
  },
  {
    title: "Build Strategies with AI",
    subtitle: "Convert plain natural language into a validated node graph.",
    icon: <Bot className="w-8 h-8 text-violet-500" />,
    content:
      "Click the 'Build with AI' button in the toolbar. Type a prompt like: 'Monitor XAUUSD on M5. If H1 RSI is below 30 and EMA is bullish, send a Telegram alert.' The AI Router generates the exact DAG automatically.",
    tips: [
      "Specify your target symbol, primary timeframe, and alert channel for higher precision.",
      "Inspect the generated validation output before applying the strategy to your canvas.",
    ],
  },
  {
    title: "Battle-Tested Workflow Templates",
    subtitle: "Kickstart your strategy with pre-built templates.",
    icon: <Layers className="w-8 h-8 text-emerald-500" />,
    content:
      "Access pre-configured templates such as Multi-Timeframe RSI Confirmation, Trailing Stop Alert, Volatility Spike Scalper, and Breakout Confirmation.",
    tips: [
      "Select a template to view its required inputs and step-by-step node flow preview.",
      "Override default symbols (e.g. BTCUSD or EURUSD) before loading onto the canvas.",
    ],
  },
  {
    title: "Test Execution & Live Deployment",
    subtitle: "Validate safety before going live.",
    icon: <Play className="w-8 h-8 text-emerald-400" />,
    content:
      "Use 'Validate' to check for missing inputs or broken connections. Click 'Run Test' to simulate execution against real-time market snapshots and view live log outputs in the Execution Logs drawer.",
    tips: [
      "All executions surface real-time toast notifications and detailed error tracebacks.",
      "Admins can toggle the global Kill Switch at any time from the workflow management dashboard.",
    ],
  },
];

interface WorkflowGuideTourProps {
  pageKey?: string;
  title?: string;
}

export function WorkflowGuideTour({ pageKey = "workflow_studio", title = "Page Guide & Tour" }: WorkflowGuideTourProps) {
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const storageKey = `algovault_tour_seen_${pageKey}`;

  const currentStep = GUIDE_STEPS[stepIndex];

  const handleNext = () => {
    if (stepIndex < GUIDE_STEPS.length - 1) {
      setStepIndex((prev) => prev + 1);
    } else {
      handleFinish();
    }
  };

  const handlePrev = () => {
    if (stepIndex > 0) {
      setStepIndex((prev) => prev - 1);
    }
  };

  const handleFinish = () => {
    try {
      localStorage.setItem(storageKey, "true");
    } catch {}
    setOpen(false);
  };

  return (
    <>
      {/* Trigger Button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setStepIndex(0);
          setOpen(true);
        }}
        className="text-xs h-8 gap-1.5 border-border hover:bg-muted font-medium"
      >
        <HelpCircle size={14} className="text-blue-500" />
        {title}
      </Button>

      {/* Guide Dialog Modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[95vw] sm:max-w-xl md:max-w-2xl p-0 overflow-hidden rounded-2xl border border-border">
          {/* Header */}
          <div className="px-6 pt-5 pb-4 border-b border-border bg-card flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px] px-2 py-0.5">
                Step {stepIndex + 1} of {GUIDE_STEPS.length}
              </Badge>
              <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                Workflow Guide
              </span>
            </div>

            {/* Step indicators */}
            <div className="flex items-center gap-1.5">
              {GUIDE_STEPS.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setStepIndex(idx)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    idx === stepIndex
                      ? "w-6 bg-blue-500"
                      : idx < stepIndex
                      ? "bg-blue-500/40"
                      : "bg-muted-foreground/30"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Step Body */}
          <div className="p-6 space-y-5 bg-background">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-2xl bg-muted/30 border border-border shrink-0">
                {currentStep.icon}
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground">{currentStep.title}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{currentStep.subtitle}</p>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
              {currentStep.content}
            </p>

            {/* Tips section */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-2.5">
              <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Info size={14} className="text-blue-500" /> Key Features &amp; Best Practices
              </div>
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                {currentStep.tips.map((tip, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <CheckCircle2 size={13} className="text-emerald-500 shrink-0 mt-0.5" />
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Footer Controls */}
          <div className="px-6 py-4 border-t border-border bg-card flex items-center justify-between">
            <Button
              size="sm"
              variant="ghost"
              onClick={handlePrev}
              disabled={stepIndex === 0}
              className="text-xs"
            >
              <ChevronLeft size={14} className="mr-1" /> Previous
            </Button>

            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleFinish} className="text-xs">
                Skip Guide
              </Button>
              <Button
                size="sm"
                onClick={handleNext}
                className="text-xs bg-gradient-to-r from-blue-600 to-violet-600 text-white"
              >
                {stepIndex === GUIDE_STEPS.length - 1 ? (
                  <>
                    Finish Guide <CheckCircle2 size={14} className="ml-1.5" />
                  </>
                ) : (
                  <>
                    Next Step <ChevronRight size={14} className="ml-1.5" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
