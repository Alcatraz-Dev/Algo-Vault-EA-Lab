/**
 * Workflow Automation — RTDB layout (RTDB only, no Firestore).
 *
 *   workflowAutomation/{userId}/{workflowId}          WorkflowAutomation (latest + version counter)
 *   workflowAutomationVersions/{userId}/{workflowId}/{version}   immutable version snapshots
 *   workflowAutomationRuns/{userId}/{runId}           WorkflowRun
 *   workflowAutomationRunNodes/{runId}/{nodeId}        NodeExecutionRecord (userId embedded for rules)
 *   workflowAutomationSignals/{userId}/{signalId}      signal.create artifacts
 *   workflowAutomationRequests/{userId}/{requestId}    execution.place_order artifacts
 *   workflowAutomationReports/{userId}/{reportId}      reports.build_report artifacts
 *   workflowAutomationVariables/{userId}/{name}        storage.rtdb_write whitelisted writes
 *   workflowAutomationDrafts/{userId}/{draftId}        AI builder drafts
 *   workflowAutomationMarketplace/{itemId}             marketplace / admin templates (cross-user)
 *   workflowAutomationSettings/{key}                   global settings incl. kill switch (admin)
 *   workflowAutomationSchedules/{userId}/{workflowId}  active schedule bookkeeping (server)
 *   workflowAutomationScheduleQueue/{bucket}/{key}     due-workflow queue buckets (server)
 */

export const WF_DB_VERSION = "1.0.0";

export const PATHS = {
    workflow: (uid: string, workflowId: string) => `workflowAutomation/${uid}/${workflowId}`,
    workflows: (uid: string) => `workflowAutomation/${uid}`,
    version: (uid: string, workflowId: string, version: number) =>
        `workflowAutomationVersions/${uid}/${workflowId}/${version}`,
    versions: (uid: string, workflowId: string) => `workflowAutomationVersions/${uid}/${workflowId}`,
    run: (uid: string, runId: string) => `workflowAutomationRuns/${uid}/${runId}`,
    runs: (uid: string) => `workflowAutomationRuns/${uid}`,
    runNode: (runId: string, nodeId: string) => `workflowAutomationRunNodes/${runId}/${nodeId}`,
    runNodes: (runId: string) => `workflowAutomationRunNodes/${runId}`,
    signal: (uid: string, signalId: string) => `workflowAutomationSignals/${uid}/${signalId}`,
    signals: (uid: string) => `workflowAutomationSignals/${uid}`,
    request: (uid: string, requestId: string) => `workflowAutomationRequests/${uid}/${requestId}`,
    requests: (uid: string) => `workflowAutomationRequests/${uid}`,
    report: (uid: string, reportId: string) => `workflowAutomationReports/${uid}/${reportId}`,
    reports: (uid: string) => `workflowAutomationReports/${uid}`,
    variables: (uid: string) => `workflowAutomationVariables/${uid}`,
    draft: (uid: string, draftId: string) => `workflowAutomationDrafts/${uid}/${draftId}`,
    drafts: (uid: string) => `workflowAutomationDrafts/${uid}`,
    marketplaceItem: (itemId: string) => `workflowAutomationMarketplace/${itemId}`,
    marketplace: () => `workflowAutomationMarketplace`,
    settings: (key: string) => `workflowAutomationSettings/${key}`,
    schedule: (uid: string, workflowId: string) => `workflowAutomationSchedules/${uid}/${workflowId}`,
    schedules: () => `workflowAutomationSchedules`,
    scheduleQueue: (bucket: string, key: string) => `workflowAutomationScheduleQueue/${bucket}/${key}`,
    scheduleQueueBucket: (bucket: string) => `workflowAutomationScheduleQueue/${bucket}`,
} as const;

/** Buckets for the due-workflow queue: BUCKET_MS-wide windows keyed by start timestamp. */
export const SCHEDULE_BUCKET_MS = 5 * 60 * 1000;

export function scheduleBucketFor(timestampMs: number): number {
    return Math.floor(timestampMs / SCHEDULE_BUCKET_MS) * SCHEDULE_BUCKET_MS;
}

export function queueKey(query: { uid: string; workflowId: string }): string {
    return `${query.uid}:${query.workflowId}`;
}