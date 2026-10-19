import { isProSubscription } from "../access";

export function runAccessTests(): boolean {
    let passed = 0;
    let failed = 0;

    function check(name: string, actual: boolean, expected: boolean) {
        if (actual === expected) {
            passed++;
            console.log(`PASS: ${name}`);
        } else {
            failed++;
            console.error(`FAIL: ${name} — expected ${expected}, got ${actual}`);
        }
    }

    // Missing / absent subscription is never entitled.
    check("null subscription", isProSubscription(null), false);
    check("undefined subscription", isProSubscription(undefined), false);

    // Inactive status is never entitled, even with a paid plan.
    check("canceled + pro plan", isProSubscription({ status: "canceled", plan: "pro" }), false);
    check("past_due + pro plan", isProSubscription({ status: "past_due", plan: "pro" }), false);
    check("inactive status + pro plan", isProSubscription({ status: "inactive", plan: "pro" }), false);

    // Active + paid plans are entitled.
    check("active + pro plan", isProSubscription({ status: "active", plan: "pro" }), true);
    check("active + enterprise plan", isProSubscription({ status: "active", plan: "enterprise" }), true);
    check("active + elite plan", isProSubscription({ status: "active", plan: "elite" }), true);
    check("active + vip plan", isProSubscription({ status: "active", plan: "vip" }), true);
    check("trialing + pro plan", isProSubscription({ status: "trialing", plan: "pro" }), true);
    check("active=true flag + pro plan", isProSubscription({ active: true, plan: "pro" }), true);

    // THE FIX: an active subscription with NO plan is NOT entitled (fail closed).
    check("active + missing plan", isProSubscription({ status: "active" }), false);
    check("active + null plan", isProSubscription({ status: "active", plan: null }), false);
    check("active + empty plan", isProSubscription({ status: "active", plan: "" }), false);
    check("active + free plan", isProSubscription({ status: "active", plan: "free" }), false);
    check("active + basic plan", isProSubscription({ status: "active", plan: "basic" }), false);

    // Explicit hasSubscription flag on an active record is entitled.
    check("active + hasSubscription true", isProSubscription({ status: "active", hasSubscription: true }), true);
    check("active + hasSubscription false", isProSubscription({ status: "active", hasSubscription: false }), false);

    // Non-object values are not entitled.
    check("string subscription", isProSubscription("active"), false);
    check("number subscription", isProSubscription(1), false);
    check("array subscription", isProSubscription(["pro"]), false);

    console.log(`\nAccess tests: ${passed} passed, ${failed} failed`);
    return failed === 0;
}
