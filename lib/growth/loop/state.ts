import { GrowthOpportunity } from "../opportunities/types";
import { GrowthPolicy, DEFAULT_GROWTH_POLICY } from "../policies/types";

export type LoopState = {
    lastScan: number;
    nextScan: number;
    activeOpportunities: string[];
    queuedOpportunities: string[];
    completedOpportunities: string[];
    rejectedOpportunities: string[];
    expiredOpportunities: string[];
    executionCountToday: number;
    lastExecutionResults: string[];
    mode: GrowthPolicy["mode"];
};

export function getDefaultLoopState(): LoopState {
    return {
        lastScan: 0,
        nextScan: Date.now() + 60 * 60 * 1000,
        activeOpportunities: [],
        queuedOpportunities: [],
        completedOpportunities: [],
        rejectedOpportunities: [],
        expiredOpportunities: [],
        executionCountToday: 0,
        lastExecutionResults: [],
        mode: DEFAULT_GROWTH_POLICY.mode,
    };
}
