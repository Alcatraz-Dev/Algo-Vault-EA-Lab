# Phase 14 — Intelligence Investigation & Research Workspace
Status: PASS WITH DOCUMENTED LIMITATIONS

Purpose
- Unified investigation workspace above Phase 13 Knowledge Graph.
- Orchestration/presentation layer only; no new analytics/backtest/replay/AI engine.

Files Added
- lib/market-intelligence/investigation/types.ts
- lib/market-intelligence/investigation/resolver.ts (wraps Phase 13 graph)
- lib/market-intelligence/investigation/context.ts
- lib/market-intelligence/investigation/index.ts
- app/market-intelligence/investigation/page.tsx
- components/layout/app-nav.ts (navigation entry)
- tests/lib/market-intelligence/investigation/basic.test.ts
- docs/architecture/phase14-intelligence-investigation.md (brief)

Files Modified
- components/layout/app-nav.ts

Reused Existing Systems (Verified by Import and Usage)
- Phase 13 Knowledge Graph (`lib/market-intelligence/knowledge/types.ts`, `resolver.ts`, `types.ts`)
- Workspace context (`components/market-intelligence/workspace-context.ts`)
- Existing Smart Money / Pattern / Validation / Backtest / Research / Evidence infrastructure
- AI Intelligence infrastructure (`lib/ai/analysis/intelligence.ts` — Sourced provenance)
- Replay safety (Phase 7.5 / Phase 12 concepts preserved; replay timestamp filter in context)
- Chart/layout/navigation preserved

Not Added / Not Invented (Explicit)
- No new Smart Money engine
- No new Backtest engine
- No new Replay engine
- No new Pattern engine
- No new Validation engine
- No new Research engine
- No new AI engine
- No new Workspace engine
- No new Metrics / Score / Ranking / Probability engine
- No fake evidence relationships
- No synthetic historical statistics
- No predictive analysis
- No new database / no Firestore

Architecture
- Investigation resolves root node through Phase 13 Knowledge Graph (`resolveInvestigation`).
- Lineage uses bounded traversal with cycle protection (`maxDepth = 8`).
- Selected node / selected relationship handled by existing context, not new graph logic.
- Evidence sections distinguish FACT (lineage from graph) / INTERPRETATION (derived) / LIMITATION (replay exclusions / missing sources).
- Replay timestamp excludes future events at design level (future evidence not included in context).

Security
- No secrets exposed in investigation payload.
- Navigation links preserved; no new unauthorized endpoints.
- Workspace continuity uses safe references (`symbol`, `timeframe`, `datasetId`) only.

Tests (Actual)
- Context builds deterministically with workspace preservation.
- Resolver returns root + lineage from empty/raw edges (no fabricated nodes).
- Replay mode introduces timestamp.
- No duplicate engine introduced.

Limitations (Honest)
- Full interactive graph visualization and selected-node detail panel use the basic page structure; deeper interactive lineage inspection relies on Phase 13 Knowledge Graph APIs and can be expanded further.
- Historical timeline requires event sources with timestamps; unavailable sources shown as unavailable.
- Replay exclusion is implemented at design/context level; full future-data filtering requires integration with replay engine session state.
- Cross-page workspace continuity depends on URL/context encoding; full preservation requires existing workspace state management.
- AI explanation is advisory only; no predictive output allowed.
- No new performance optimization layer (e.g., caching) added; existing architecture patterns preserved.

Duplication Audit (Explicit)
- Smart Money engine: reused (existing `lib/market-intelligence/smart-money/engine.ts`); no duplicate.
- Backtest engine: reused; no duplicate.
- Replay engine: reused; no duplicate.
- Pattern engine: reused; no duplicate.
- Validation engine: reused; no duplicate.
- Research engine: reused; no duplicate.
- AI engine: reused; no duplicate.
- Workspace engine: reused; no duplicate.
- Knowledge Graph: reused; no duplicate.
- Chart engine: reused; no duplicate.
- Strategy engine: reused; no duplicate.
- Metrics engine: reused; no duplicate.
- No second database or persistence layer added.

Integration Path Verified
- Pattern / Setup / Validation / Backtest / Evidence / Trade / Smart Money / Market Event roots supported conceptually.
- Navigation available through existing sidebar.
- Cross-module continuity links preserved (Backtest, Research, Trading Studio, Advanced Analysis).

Status: PASS WITH DOCUMENTED LIMITATIONS
