/**
 * Feature flags for AI Trading Teams (spec §47).
 *
 * Flags are read from environment variables so they can be flipped without a
 * code change and so a staged rollout (or instant rollback) is possible:
 *
 *   AI_TRADING_TEAMS_ENABLED=false        disable the whole feature
 *   AI_CUSTOM_AGENTS_ENABLED=false        disable user-defined custom agents
 *   AI_ADMIN_AGENT_FACTORY_ENABLED=false  disable the admin agent factory
 *
 * Defaults: everything ON (the feature is shipped behind flags so operators can
 * turn it off; a missing flag must not silently hide a paid feature). Values
 * "false", "0", "off", "no" (case-insensitive) disable a flag.
 */

function readFlag(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (raw === undefined || raw === "") return fallback;
    const normalized = raw.trim().toLowerCase();
    if (["false", "0", "off", "no", "disabled"].includes(normalized)) return false;
    if (["true", "1", "on", "yes", "enabled"].includes(normalized)) return true;
    return fallback;
}

export const FEATURE_FLAGS = {
    teams: "AI_TRADING_TEAMS_ENABLED",
    customAgents: "AI_CUSTOM_AGENTS_ENABLED",
    adminAgentFactory: "AI_ADMIN_AGENT_FACTORY_ENABLED",
} as const;

export function isAITeamsEnabled(): boolean {
    return readFlag(FEATURE_FLAGS.teams, true);
}

export function isCustomAgentsEnabled(): boolean {
    return isAITeamsEnabled() && readFlag(FEATURE_FLAGS.customAgents, true);
}

export function isAgentFactoryEnabled(): boolean {
    return isAITeamsEnabled() && readFlag(FEATURE_FLAGS.adminAgentFactory, true);
}

/** Snapshot used by API responses so the UI can hide disabled surfaces. */
export function featureFlagSnapshot(): {
    aiTeamsEnabled: boolean;
    customAgentsEnabled: boolean;
    adminAgentFactoryEnabled: boolean;
} {
    return {
        aiTeamsEnabled: isAITeamsEnabled(),
        customAgentsEnabled: isCustomAgentsEnabled(),
        adminAgentFactoryEnabled: isAgentFactoryEnabled(),
    };
}
