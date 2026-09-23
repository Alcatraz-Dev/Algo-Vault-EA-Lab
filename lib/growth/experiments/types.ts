/**
 * Growth Engine — real experiment framework.
 */

export const EXPERIMENT_STATES = ["DRAFT", "RUNNING", "PAUSED", "COMPLETED"] as const;

export type ExperimentVariant = {
    id: string;
    label: string;
    settings?: Record<string, unknown>;
};

export type Experiment = {
    id: string;
    name: string;
    hypothesis: string;
    variants: ExperimentVariant[];
    targetMetric: string;
    status: typeof EXPERIMENT_STATES[number];
    startAt: number;
    endAt?: number;
    createdAt: number;
    updatedAt: number;
};
