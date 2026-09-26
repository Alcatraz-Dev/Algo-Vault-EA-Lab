/**
 * Walk-Forward — rolling and expanding windows.
 */
import { splitDataset, ResearchSplit } from "./oos/split";

export interface WalkForwardWindow {
  index: number;
  training: ResearchSplit;
  validation: ResearchSplit;
  description: string;
}

export interface WalkForwardConfig {
  mode: "rolling" | "expanding";
  datasetStart: number;
  datasetEnd: number;
  trainingDuration: number;
  validationDuration: number;
  stepDuration: number;
}

export function generateWalkForwardWindows(config: WalkForwardConfig): WalkForwardWindow[] {
  const windows: WalkForwardWindow[] = [];
  const minData = config.trainingDuration + config.validationDuration;
  if (config.datasetEnd - config.datasetStart < minData) {
    return windows;
  }
  let trainStart = config.datasetStart;
  let valEnd = trainStart + config.trainingDuration + config.validationDuration;
  let index = 1;
  while (valEnd <= config.datasetEnd) {
    const trainEnd = trainStart + config.trainingDuration;
    windows.push({
      index,
      training: { name: `training_${index}`, start: trainStart, end: trainEnd },
      validation: { name: `validation_${index}`, start: trainEnd, end: valEnd },
      description: `Window ${index}: ${new Date(trainStart).toISOString().split("T")[0]} → ${new Date(valEnd).toISOString().split("T")[0]}`,
    });
    if (config.mode === "rolling") {
      trainStart += config.stepDuration;
    } else if (config.mode === "expanding") {
      // Expanding: training start stays at datasetStart, training end moves forward
      trainStart = config.datasetStart;
      valEnd = valEnd + config.stepDuration;
      const trainEndExpanding = Math.min(valEnd - config.validationDuration, config.datasetEnd - config.validationDuration);
      if (trainEndExpanding <= config.datasetStart) break;
    } else {
      break;
    }
    index++;
  }
  return windows.slice(0, 50); // hard limit for safety
}
