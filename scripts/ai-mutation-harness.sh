#!/bin/bash
# Mutation-testing harness for the AI usage & budget feature.
#
# Applies one named mutation, runs the suite, records exactly which checks
# caught it, then restores the original file. Nothing here is a permanent edit.
#
# Usage: scripts/ai-mutation-harness.sh <mutation-name>

set -uo pipefail
cd "$(dirname "$0")/.."

NAME="${1:-}"
BACKUP_DIR="$(mktemp -d)"
trap 'rm -rf "$BACKUP_DIR"' EXIT

FILES=(lib/ai/budget.ts lib/ai/router.ts lib/ai/usage-events.ts lib/ai/runtime-guards.ts)
for f in "${FILES[@]}"; do
    cp "$f" "$BACKUP_DIR/$(basename "$f")"
done

restore() {
    for f in "${FILES[@]}"; do
        cp "$BACKUP_DIR/$(basename "$f")" "$f"
    done
}

case "$NAME" in
  disable-blocking)
    # The check is still evaluated and still runs every check, but the decision
    # is forced to ALLOW — i.e. blocking is silently disabled.
    python3 - <<'PY'
import pathlib
p = pathlib.Path("lib/ai/budget.ts"); s = p.read_text()
old = "export async function evaluateAIBudget("
new = "const MUTANT_DISABLE_BLOCKING = true;\n\nexport async function evaluateAIBudget("
assert old in s
s = s.replace(old, new, 1)
# The fail-closed early return.
s = s.replace('decision: "BLOCK",', 'decision: MUTANT_DISABLE_BLOCKING ? "ALLOW" : "BLOCK",')
# The real decision: never downgrade a BLOCK check to ALLOW.
old2 = '''    const decision: AIBudgetDecision = checks.some((c) => c.decision === "BLOCK")
        ? "BLOCK"'''
new2 = '''    const decision: AIBudgetDecision = checks.some((c) => c.decision === "BLOCK")
        ? (MUTANT_DISABLE_BLOCKING ? "ALLOW" : "BLOCK")'''
assert old2 in s, "decision block not found"
s = s.replace(old2, new2, 1)
p.write_text(s)
PY
    ;;
  fallback-bypasses-global)
    # The router honours only a PER-PROVIDER block and ignores the exhausted
    # GLOBAL limit, so a request escapes the global cap by falling through to
    # another provider.
    python3 - <<'PY'
import pathlib
p = pathlib.Path("lib/ai/router.ts"); s = p.read_text()
old = 'if (budget.decision === "BLOCK") {'
assert old in s, "block branch not found"
new = ('if (budget.decision === "BLOCK" &&\n'
       '                budget.checks.some((c) => c.scope !== "global" && c.decision === "BLOCK")) {')
s = s.replace(old, new, 1)
p.write_text(s)
PY
    ;;
  substitute-model-on-block)
    # The classic violation: on BLOCK, silently swap in a different (cheaper)
    # model and let the request through instead of refusing it.
    python3 - <<'PY'
import pathlib
p = pathlib.Path("lib/ai/router.ts"); s = p.read_text()
old = 'if (budget.decision === "BLOCK") {'
assert old in s, "block branch not found"
new = ('if (budget.decision === "BLOCK") {\n'
       '                request.model = "deepseek-v4-flash-0731";\n'
       '                budget.decision = "ALLOW";\n'
       '            }\n'
       '            if (budget.decision === "BLOCK") {')
s = s.replace(old, new, 1)
p.write_text(s)
PY
    ;;
  remove-usage-persistence)
    # Accounting is switched off: the router stops persisting usage events.
    python3 - <<'PY'
import pathlib
p = pathlib.Path("lib/ai/runtime-guards.ts"); s = p.read_text()
old = "export async function recordAIUsageSafely(event: AIUsageEvent): Promise<void> {\n    try {"
assert old in s
s = s.replace(old, "export async function recordAIUsageSafely(event: AIUsageEvent): Promise<void> {\n    if (1) return;\n    try {", 1)
p.write_text(s)
PY
    ;;
  leak-prompt)
    # A prompt is smuggled into the persisted event.
    python3 - <<'PY'
import pathlib
p = pathlib.Path("lib/ai/usage-events.ts"); s = p.read_text()
old = "    if (estimatedCostUsd !== undefined) event.estimatedCostUsd = estimatedCostUsd;"
assert old in s
new = (old + "\n"
       '    (event as unknown as Record<string, unknown>).prompt = "LEAKED_USER_PROMPT_SENTINEL";\n'
       '    (event as unknown as Record<string, unknown>).raw = "LEAKED_RAW_RESPONSE_SENTINEL";')
s = s.replace(old, new, 1)
p.write_text(s)
PY
    ;;
  *)
    echo "unknown mutation: $NAME" >&2
    exit 2
    ;;
esac

echo "### MUTATION: $NAME"
echo "### diff applied:"
git diff --no-index --stat /dev/null /dev/null >/dev/null 2>&1
npm run test:ai > "$BACKUP_DIR/out.log" 2>&1
echo "### checks that CAUGHT it (FAIL):"
grep '  FAIL:' "$BACKUP_DIR/out.log" || echo "  <NONE — MUTATION SURVIVED>"
echo "### totals: PASS=$(grep -c '  PASS:' "$BACKUP_DIR/out.log") FAIL=$(grep -c '  FAIL:' "$BACKUP_DIR/out.log")"

restore
echo "### restored."
