/**
 * Growth Engine — basic real experiment execution.
 */

import { Experiment } from "./types";

export function createExperiment(name: string, hypothesis: string, variants: { label: string; settings?: Record<string, unknown> }[]): Experiment {
    return {
        id: "exp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5),
        name,
        hypothesis,
        variants: variants.map((v, i) => ({ id: `v${i}`, label: v.label, settings: v.settings })),
        targetMetric: "CTR",
        status: "DRAFT",
        startAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}
