// Challenge lifecycle / state machine tests.

import { createSuite } from "./harness";
import { canTransition, applyTransition, allowedTransitions, InvalidTransitionError } from "../state-machine";
import { isTerminalStatus, type ChallengeStatus } from "../types";
import { NOW, nextEventId } from "./fixtures";

export async function runLifecycleTests(): Promise<boolean> {
    const s = createSuite("lifecycle");

    s.section("Transition table");
    s.check(canTransition("DRAFT", "AVAILABLE"), "DRAFT → AVAILABLE");
    s.check(canTransition("AVAILABLE", "ACTIVE"), "AVAILABLE → ACTIVE (join)");
    s.check(canTransition("ACTIVE", "PAUSED"), "ACTIVE → PAUSED");
    s.check(canTransition("PAUSED", "ACTIVE"), "PAUSED → ACTIVE (resume)");
    s.check(canTransition("ACTIVE", "PASSED"), "ACTIVE → PASSED");
    s.check(canTransition("ACTIVE", "FAILED"), "ACTIVE → FAILED");
    s.check(canTransition("ACTIVE", "EXPIRED"), "ACTIVE → EXPIRED");
    s.check(canTransition("ACTIVE", "CANCELLED"), "ACTIVE → CANCELLED");
    s.check(canTransition("FAILED", "ARCHIVED"), "FAILED → ARCHIVED");

    s.section("Invalid transitions are rejected");
    s.check(!canTransition("PASSED", "ACTIVE"), "PASSED → ACTIVE forbidden");
    s.check(!canTransition("FAILED", "ACTIVE"), "FAILED → ACTIVE forbidden (no revive)");
    s.check(!canTransition("EXPIRED", "PASSED"), "EXPIRED → PASSED forbidden");
    s.check(!canTransition("CANCELLED", "ACTIVE"), "CANCELLED → ACTIVE forbidden");
    s.check(!canTransition("ARCHIVED", "ACTIVE"), "ARCHIVED → ACTIVE forbidden");
    s.check(!canTransition("AVAILABLE", "PASSED"), "AVAILABLE → PASSED forbidden (must activate first)");
    s.check(allowedTransitions("ARCHIVED").length === 0, "ARCHIVED is terminal (no outbound transitions)");

    let threw = false;
    try {
        applyTransition({ attemptId: "a", from: "FAILED", to: "PASSED", timestamp: NOW, reason: "x", eventId: nextEventId() });
    } catch (err) {
        threw = err instanceof InvalidTransitionError;
    }
    s.check(threw, "applyTransition throws InvalidTransitionError on illegal move");

    s.section("Transition events");
    const result = applyTransition({
        attemptId: "att_1",
        from: "ACTIVE",
        to: "PASSED",
        timestamp: NOW,
        reason: "Profit target reached.",
        eventId: "evt_1",
        actor: "system",
    });
    s.check(result.changed && result.event !== null, "legal transition returns an event");
    s.check(result.event?.type === "STATUS_CHANGE", "event type is STATUS_CHANGE");
    s.check(result.event?.payload?.from === "ACTIVE" && result.event?.payload?.to === "PASSED", "event records from/to");
    s.check(result.event?.attemptId === "att_1", "event is attempt-scoped");

    const noopAllowed = applyTransition({ attemptId: "a", from: "ACTIVE", to: "ACTIVE", timestamp: NOW, reason: "x", eventId: "e", allowNoop: true });
    s.check(!noopAllowed.changed && noopAllowed.event === null, "allowNoop: same status is a no-op, not an error");

    let noopThrew = false;
    try {
        applyTransition({ attemptId: "a", from: "ACTIVE", to: "ACTIVE", timestamp: NOW, reason: "x", eventId: "e" });
    } catch {
        noopThrew = true;
    }
    s.check(noopThrew, "same-status transition throws without allowNoop");

    s.section("Full happy-path journey");
    const journey: Array<[ChallengeStatus, ChallengeStatus]> = [
        ["DRAFT", "AVAILABLE"],
        ["AVAILABLE", "ACTIVE"],
        ["ACTIVE", "PAUSED"],
        ["PAUSED", "ACTIVE"],
        ["ACTIVE", "PASSED"],
        ["PASSED", "ARCHIVED"],
    ];
    let journeyOk = true;
    for (const [from, to] of journey) {
        if (!canTransition(from, to)) journeyOk = false;
    }
    s.check(journeyOk, "DRAFT → AVAILABLE → ACTIVE ⇄ PAUSED → PASSED → ARCHIVED all legal");

    s.section("Terminal status helper");
    s.check(isTerminalStatus("PASSED") && isTerminalStatus("FAILED") && isTerminalStatus("EXPIRED") && isTerminalStatus("CANCELLED"), "settled statuses are terminal");
    s.check(!isTerminalStatus("ACTIVE") && !isTerminalStatus("PAUSED"), "ACTIVE/PAUSED are not terminal");
    s.check(!isTerminalStatus("AVAILABLE"), "AVAILABLE is not terminal");

    return s.finish();
}
