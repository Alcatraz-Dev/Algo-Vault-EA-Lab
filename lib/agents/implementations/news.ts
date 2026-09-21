import { AgentExecutionRecord, AgentOutput, WorkflowContext } from "../types";
import { addEvidence, round, successOutput, upper } from "./shared";

/**
 * News / Event Agent.
 *
 * Responsible for surfacing relevant scheduled economic events and calendar
 * context for the monitored symbols. It states what the calendar says and
 * NEVER claims certainty about the market impact of an event.
 */

type CalendarEvent = {
    id: string;
    title: string;
    currency: string;
    impact: "High" | "Medium" | "Low" | string;
    date: string;
    timeUtc: string;
};

export async function newsAgent(
    record: AgentExecutionRecord,
    context: WorkflowContext
): Promise<AgentOutput> {
    const incoming = (context.news?.incoming || []) as CalendarEvent[];
    const relevant = (context.news?.relevant || []) as CalendarEvent[];

    // Currencies relevant to the monitored symbols (uppercase suffix of the
    // symbol, e.g. XAUUSD → USD, GBPJPY → JPY, EURUSD → EUR + USD).
    const currencies = new Set<string>();
    for (const symbol of Object.keys(context.market || {})) {
        const s = String(symbol).toUpperCase();
        for (const [, suffix] of [["", "USD"], ["", "EUR"], ["", "GBP"], ["", "JPY"], ["", "CHF"], ["", "AUD"], ["", "CAD"], ["", "NZD"], ["", "XAU"], ["", "BTC"], ["", "ETH"]]) {
            if (s.endsWith(suffix) && suffix.length >= 3) currencies.add(suffix);
        }
        if (s.startsWith("XAU")) currencies.add("XAU");
    }

    const findings: AgentOutput["findings"] = [];
    const evidence: AgentOutput["evidence"] = [];
    const dataUsed: string[] = [];
    const warnings: string[] = [];

    const candidates = incoming.length > 0 ? incoming : relevant;
    const watched = candidates.filter((e) => currencies.size === 0 || currencies.has(String(e.currency || "").toUpperCase()));

    const used = "news:calendar";
    const evId = addEvidence(evidence, dataUsed, {
        dataUsed: used,
        value: watched.length,
        note: "scheduled events matching monitored currencies",
    });

    for (const event of watched.slice(0, 8)) {
        findings.push({
            id: `news_${event.id || event.title}`,
            title: `Scheduled event · ${event.currency || "—"}`,
            detail: `${event.title} (${event.currency}) ${event.date || ""} ${event.timeUtc || ""} UTC · calendar flags ${event.impact || "unknown"} impact. The calendar does not predict direction.`,
            evidence: [evId],
            tags: ["news"],
        });
        if (upper(String(event.impact)) === "high") {
            warnings.push(`${event.currency || "—"}: high-impact event scheduled (${event.title}). Review exposure around the release.`);
        }
    }

    if (watched.length === 0) {
        return successOutput({
            agentId: record.agentId,
            summary: "No scheduled events match the monitored instruments in the loaded window.",
            findings: [{ id: "news_none", title: "Calendar quiet", detail: "No matching high/medium impact events found." }],
            evidence,
            dataUsed,
            nextStep: "strategy_matching",
        });
    }

    return successOutput({
        agentId: record.agentId,
        summary: `${watched.length} scheduled event(s) match the monitored instruments.`,
        findings,
        evidence,
        warnings,
        dataUsed,
        nextStep: "strategy_matching",
        metadata: { eventCount: watched.length, highImpactCount: warnings.length },
    });
}

export { round };