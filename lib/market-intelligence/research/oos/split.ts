/**
 * Data Split — deterministic, no overlap, explicit boundaries.
 */
export interface ResearchPeriod {
  name: string;
  start: number;
  end: number;
}

export interface ResearchSplit {
  training: ResearchPeriod;
  validation: ResearchPeriod;
}

export function splitDataset(startTime: number, endTime: number, splitRatio: number = 0.7): ResearchSplit {
  const total = endTime - startTime;
  const splitAt = startTime + total * splitRatio;
  return {
    training: { name: "training", start: startTime, end: splitAt },
    validation: { name: "validation", start: splitAt, end: endTime },
  };
}

export function validateSplit(split: ResearchSplit, dataStart: number, dataEnd: number): string[] {
  const errors: string[] = [];
  if (split.training.start < dataStart || split.training.end > dataEnd) errors.push("Training out of data range.");
  if (split.validation.start < dataStart || split.validation.end > dataEnd) errors.push("Validation out of data range.");
  if (split.training.end > split.validation.start) errors.push("Training/Validation overlap.");
  if (split.training.start >= split.training.end) errors.push("Invalid training period.");
  if (split.validation.start >= split.validation.end) errors.push("Invalid validation period.");
  return errors;
}
