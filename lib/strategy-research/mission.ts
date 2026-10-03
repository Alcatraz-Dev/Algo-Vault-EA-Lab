// ─────────────────────────────────────────────────────────────────────────────
// Mission lifecycle — creation, control transitions, duplicate-active guard.
// Pure orchestration over the existing RTDB conventions; no new engines.
// ─────────────────────────────────────────────────────────────────────────────

import { checkAccess } from "@/lib/strategy-lab/license";
import {
    MISSION_STAGES,
    MissionStage,
    MissionStatus,
    ResearchMission,
    ResearchMissionSpec,
} from "./types";
import { emptyStageStates, MissionValidationResult, validateMissionName, validateMissionSpec } from "./validation";
import {
    findActiveMissionByFingerprint,
    getMission,
    logEvent,
    missionFingerprint,
    newResearchId,
    sanitizeMissionForClient,
    saveMission,
    updateMission,
} from "./storage";

export const RESEARCH_LINEAGE_NOTE =
    "Research-only pipeline. AI proposes structured hypotheses; deterministic AlgoVault engines (Strategy Lab backtest, OOS/walk-forward validation, Monte Carlo, robustness) test them. No live broker execution is performed or enabled by this engine.";

export interface CreateMissionOutcome {
    ok: boolean;
    status: number;
    error?: string;
    mission?: ResearchMission;
    validation?: MissionValidationResult;
}

/** Creates a Pro-gated research mission. Refuses duplicate active missions with the same spec. */
export async function createMission(
    uid: string,
    rawName: unknown,
    rawSpec: unknown
): Promise<CreateMissionOutcome> {
    // Pro entitlement — same source of truth as the Strategy Lab.
    const access = await checkAccess(uid);
    if (!access.accessible) {
        return { ok: false, status: 403, error: access.reason ?? "The Strategy Research engine requires an active Pro subscription or the AI Strategy Lab license." };
    }

    const validation = validateMissionSpec(rawSpec);
    if (!validation.valid || !validation.normalized) {
        return { ok: false, status: 400, error: "Invalid mission specification.", validation };
    }

    const spec: ResearchMissionSpec = validation.normalized;
    const fingerprint = missionFingerprint(uid, spec);
    const existing = await findActiveMissionByFingerprint(uid, fingerprint);
    if (existing) {
        return {
            ok: false,
            status: 409,
            error: `An active mission with the same research specification already exists (${existing.id}). Pause, resume or complete it before creating a duplicate.`,
            mission: sanitizeMissionForClient(existing),
        };
    }

    const now = Date.now();
    const mission: ResearchMission = {
        id: newResearchId("mission"),
        uid,
        name: validateMissionName(rawName),
        spec,
        status: "running",
        stages: emptyStageStates(),
        currentStage: "data",
        dataQuality: null,
        hypothesisCount: 0,
        compiledCount: 0,
        rejectedCount: 0,
        survivorCount: 0,
        failState: null,
        budgetUsed: { hypotheses: 0, backtests: 0, aiRequests: 0, startedAt: now },
        lease: null,
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        lineageNote: RESEARCH_LINEAGE_NOTE,
    };

    await saveMission({ ...mission, fingerprint } as ResearchMission & { fingerprint: string });
    await logEvent(uid, mission.id, "data", "info", "Mission created — pipeline queued.", undefined, "RESEARCH_CREATED");
    return { ok: true, status: 201, mission };
}

export interface MissionControlOutcome {
    ok: boolean;
    status: number;
    error?: string;
    mission?: ResearchMission;
}

const CONTROL_TRANSITIONS: Record<string, { from: MissionStatus[]; to: MissionStatus }> = {
    pause: { from: ["running"], to: "paused" },
    resume: { from: ["paused", "failed"], to: "running" },
    cancel: { from: ["running", "paused", "failed", "draft"], to: "cancelled" },
};

/** Applies pause/resume/cancel with explicit legal transitions. */
export async function applyMissionControl(
    uid: string,
    missionId: string,
    action: string
): Promise<MissionControlOutcome> {
    const transition = CONTROL_TRANSITIONS[action];
    if (!transition) {
        return { ok: false, status: 400, error: "action must be pause|resume|cancel." };
    }
    const mission = await getMission(uid, missionId);
    if (!mission) return { ok: false, status: 404, error: "Mission not found." };
    if (!transition.from.includes(mission.status)) {
        return { ok: false, status: 409, error: `Cannot ${action} a mission in status "${mission.status}".` };
    }

    await updateMission(uid, missionId, { status: transition.to });
    const controlCode =
        action === "pause" ? "RESEARCH_PAUSED" : action === "resume" ? "RESEARCH_RESUMED" : "RESEARCH_CANCELLED";
    await logEvent(uid, missionId, mission.currentStage, "info", `Mission ${action}d by user.`, undefined, controlCode);
    const updated = await getMission(uid, missionId);
    return { ok: true, status: 200, mission: updated ? sanitizeMissionForClient(updated) : undefined };
}

export function nextStage(stage: MissionStage): MissionStage | null {
    const idx = MISSION_STAGES.indexOf(stage);
    return idx >= 0 && idx < MISSION_STAGES.length - 1 ? MISSION_STAGES[idx + 1] : null;
}
