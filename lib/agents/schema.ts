import { AgentContract, WorkflowDefinition, AgentStatus } from "./types";

/**
 * Agent Registry — agent/ structure in Firebase RTDB.
 *
 * Schema:
 *   agents/{agentId}: AgentContract
 *   agentVersions/{agentId}/{version}: AgentContract (version snapshot)
 *   agentWorkflows/{workflowId}: WorkflowDefinition
 *   workflowExecutions/{executionId}: WorkflowExecutionRecord
 *   workflowSteps/{stepId}: WorkflowStepRecord
 *   agentExecutions/{executionId}/{agentId}: AgentExecutionRecord
 *   agentLogs/{logId}: AgentLogRecord
 *   agentPermissions/{agentId}: { permission: boolean }
 *   agentUsage/{usageId}: AgentUsageRecord
 */

export const RTDB_SCHEMA_VERSION = "1.0.0";

export function getAgentPath(id: string): string {
    return `agents/${id}`;
}

export function getAgentVersionPath(agentId: string, version: string): string {
    return `agentVersions/${agentId}/${version}`;
}

export function getWorkflowPath(id: string): string {
    return `agentWorkflows/${id}`;
}

export function getWorkflowExecutionPath(id: string): string {
    return `workflowExecutions/${id}`;
}

export function getWorkflowStepPath(id: string): string {
    return `workflowSteps/${id}`;
}

export function getAgentExecutionPath(executionId: string, agentId: string): string {
    return `agentExecutions/${executionId}/${agentId}`;
}

export function getAgentLogPath(id: string): string {
    return `agentLogs/${id}`;
}

export function getAgentPermissionsPath(agentId: string): string {
    return `agentPermissions/${agentId}`;
}

export function getAgentUsagePath(id: string): string {
    return `agentUsage/${id}`;
}

/**
 * Default security rules string for the agent system.
 * Users can only read their own executions; admins manage definitions.
 */
export function agentSecurityRules(): Record<string, unknown> {
    return {
        "agents": {
            ".read": "auth != null && (auth.token.admin === true || root.child('users').child(auth.uid).child('role').val() === 'admin')",
            ".write": "auth != null && (auth.token.admin === true || root.child('users').child(auth.uid).child('role').val() === 'admin')",
            "$agentId": {
                ".read": "auth != null && (auth.token.admin === true || root.child('users').child(auth.uid).child('role').val() === 'admin')",
                ".write": "auth != null && (auth.token.admin === true || root.child('users').child(auth.uid).child('role').val() === 'admin')",
            },
        },
        "agentVersions": {
            ".read": "auth != null && (auth.token.admin === true || root.child('users').child(auth.uid).child('role').val() === 'admin')",
            ".write": "auth != null && (auth.token.admin === true || root.child('users').child(auth.uid).child('role').val() === 'admin')",
        },
        "agentWorkflows": {
            ".read": "auth != null && (auth.token.admin === true || root.child('users').child(auth.uid).child('role').val() === 'admin')",
            ".write": "auth != null && (auth.token.admin === true || root.child('users').child(auth.uid).child('role').val() === 'admin')",
        },
        "workflowExecutions": {
            "$executionId": {
                ".read": "auth != null && (auth.uid === data.child('userId').val() || auth.token.admin === true || root.child('users').child(auth.uid).child('role').val() === 'admin')",
                ".write": "auth != null && (auth.uid === data.child('userId').val() || auth.token.admin === true || root.child('users').child(auth.uid).child('role').val() === 'admin')",
            },
        },
        "workflowSteps": {
            "$stepId": {
                ".read": "auth != null && (auth.token.admin === true || root.child('users').child(auth.uid).child('role').val() === 'admin')",
                ".write": "auth != null && (auth.token.admin === true || root.child('users').child(auth.uid).child('role').val() === 'admin')",
            },
        },
        "agentExecutions": {
            "$executionId": {
                "$agentId": {
                    ".read": "auth != null && (auth.token.admin === true || root.child('users').child(auth.uid).child('role').val() === 'admin')",
                    ".write": "auth != null && (auth.token.admin === true || root.child('users').child(auth.uid).child('role').val() === 'admin')",
                },
            },
        },
        "agentLogs": {
            "$logId": {
                ".read": "auth != null && (auth.token.admin === true || root.child('users').child(auth.uid).child('role').val() === 'admin')",
                ".write": "auth != null && (auth.token.admin === true || root.child('users').child(auth.uid).child('role').val() === 'admin')",
            },
        },
        "agentPermissions": {
            ".read": "auth != null && (auth.token.admin === true || root.child('users').child(auth.uid).child('role').val() === 'admin')",
            ".write": "auth != null && (auth.token.admin === true || root.child('users').child(auth.uid).child('role').val() === 'admin')",
        },
        "agentUsage": {
            ".read": "auth != null && (auth.token.admin === true || root.child('users').child(auth.uid).child('role').val() === 'admin')",
            ".write": "auth != null && (auth.token.admin === true || root.child('users').child(auth.uid).child('role').val() === 'admin')",
        },
    };
}
