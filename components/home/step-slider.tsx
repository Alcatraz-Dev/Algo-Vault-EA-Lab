"use client";

import { useState } from "react";

export interface StepSliderProps {
  ariaLabel?: string;
  formatLabel?: (value: number) => string;
  getValueText?: (value: number) => string;
  majorSteps?: number[];
  onValueChange?: (value: number) => void;
  steps?: number[];
  value?: number;
}

const PROMPT_STEPS = [5, 10, 25, 50, 100, 150, 250, 500, 1000] as const;
const THOUSAND = 1000;

const formatPrompts = (value: number) =>
  value >= THOUSAND ? `${value / THOUSAND}K` : String(value);

export function StepSlider({
  ariaLabel = "Step",
  formatLabel = formatPrompts,
  getValueText = (v) => `${v}`,
  majorSteps = [5, 25, 100, 250, 1000],
  onValueChange,
  steps = [...PROMPT_STEPS],
  value = 50,
}: StepSliderProps) {
  const [current, setCurrent] = useState(value);

  const handleChange = (v: number) => {
    setCurrent(v);
    onValueChange?.(v);
  };

  return (
    <div className="w-full">
      <div className="mb-2 flex items-baseline justify-between gap-6">
        <span className="text-xs font-medium text-muted-foreground">{ariaLabel}</span>
        <span className="font-numeric text-lg font-semibold tracking-tight">{formatLabel(current)}</span>
      </div>
      <div className="relative flex h-8 items-center">
        <div className="absolute inset-y-2 left-2 right-2 rounded-full bg-[#2b2b2b]" />
        {steps.map((step) => (
          <button
            key={step}
            type="button"
            aria-label={getValueText(step)}
            onClick={() => handleChange(step)}
            className={`absolute top-0 h-4 w-4 rounded-full border-2 transition-all duration-150 ${
              current >= step ? "border-amber-400 bg-amber-400 scale-110" : "border-muted-foreground bg-transparent scale-100"
            }`}
            style={{ left: `${(steps.indexOf(step) / (steps.length - 1)) * 100}%`, transform: "translateX(-50%)" }}
          />
        ))}
        <div
          className="absolute top-0 h-4 w-3 rounded-full bg-amber-400 shadow-md transition-all duration-150"
          style={{ left: `${(steps.indexOf(current) / (steps.length - 1)) * 100}%`, transform: "translateX(-50%)" }}
        />
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-muted-foreground font-mono">
        {majorSteps.map((s) => (
          <span key={s}>{formatLabel(s)}</span>
        ))}
      </div>
    </div>
  );
}
