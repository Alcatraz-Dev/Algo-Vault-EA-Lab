/**
 * Bot execution eligibility — ONE rule, shared by the API and the terminal.
 *
 * A bot is "eligible for execution" when the runtime can actually turn one of
 * its signals into a broker order. The UI must never offer a Start action the
 * server would refuse, and the server must never claim a bot is running when
 * the runtime cannot submit. Both therefore evaluate this single pure function
 * over facts they already hold:
 *
 *   · the deployment's own lifecycle mode (`accountMode`)
 *   · whether the strategy still exists and still matches its deployment
 *   · whether live trading is enabled for the platform
 *   · whether the MT5 gateway is reachable for the owner
 *
 * `eligible === false` is a hard blocker for STARTING. Pause and stop always
 * remain available — a user must be able to halt a bot even when it cannot
 * trade, and halting never closes open positions.
 */

import type {
    BotAccountMode,
    BotEligibility,
    BotLifecycleState,
} from "./types";

export interface BotEligibilityInput {
    runtimeState: BotLifecycleState;
    accountMode: BotAccountMode;
    /** The deployment's strategy record still exists. */
    strategyPresent: boolean;
    /** `deployment.deployedFingerprint` still equals the strategy fingerprint. */
    fingerprintMatches: boolean;
    /** The owner has a gateway token AND a resolvable connected account. */
    gatewayConnected: boolean;
    /** Server-side feature flag (`LIVE_TRADING_ENABLED`). */
    liveTradingEnabled: boolean;
}

/**
 * Evaluates the eligibility rule.
 *
 * Order matters: the first failing fact is the reason shown, so the message is
 * the actual cause rather than a later symptom.
 */
export function evaluateBotEligibility(input: BotEligibilityInput): BotEligibility {
    if (!input.strategyPresent) {
        return {
            eligible: false,
            code: "no_strategy",
            reason: "Strategy is unavailable — this bot cannot be started.",
            warning: false,
        };
    }

    // A deployment runs the strategy it was deployed with. If the strategy was
    // edited since, the runtime would execute different logic than the one the
    // user approved, so the bot must be re-deployed before it can trade.
    if (!input.fingerprintMatches) {
        return {
            eligible: false,
            code: "strategy_changed",
            reason: "Strategy changed since deployment — re-deploy before starting.",
            warning: false,
        };
    }

    if (input.accountMode === "live" && !input.liveTradingEnabled) {
        return {
            eligible: false,
            code: "live_disabled",
            reason: "Live trading is disabled — only demo bots can run.",
            warning: false,
        };
    }

    if (!input.gatewayConnected) {
        return {
            eligible: false,
            code: "gateway_offline",
            reason: "MT5 gateway is offline — connect it before starting.",
            warning: false,
        };
    }

    if (input.runtimeState === "error") {
        return {
            eligible: true,
            code: "runtime_error",
            reason: "Runtime error — starting restarts the bot.",
            warning: true,
        };
    }

    return { eligible: true, code: "eligible", reason: null, warning: false };
}
