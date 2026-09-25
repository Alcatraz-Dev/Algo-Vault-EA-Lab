# Trading Studio — Node Connectivity Implementation Plan

## Context
The Trading Studio workspace lives at `app/admin/intelligence/studio/` and is built on `@xyflow/react` (React Flow). It uses a custom node (`WfNode` in `studio-client.tsx`), custom edge (`WfEdge`), and a registry at `lib/workflows/node-registry.ts`. Nodes are defined in `lib/workflows/types.ts` (`WorkflowNode`, `WorkflowEdge`). The current builder supports adding nodes via drag-drop, visualizing them, drawing basic edges (`onConnect` → `addEdge`), saving/loading to `/api/workflows`. It does **not** yet enforce connection rules, propagate data between nodes, or provide interaction affordances on the edge / connection layer.

## Goal
Enable users to successfully **connect** nodes and **interact** with those connections within the studio workspace — including connection validation, data-flow awareness, selectable/highlightable edges, and interaction patterns that make the graph usable as a trading workflow engine.

---

## 1. Current Architecture (as-is)

| Layer | File / Module | Role |
|---|---|---|
| Canvas | `studio-client.tsx` (ReactFlow) | Renders nodes/edges; `onConnect` adds edges |
| Node UI | `WfNode` component (line 66) | Target handle (top) + source handle (bottom); category-styled header/body |
| Edge UI | `WfEdge` component (line 128) | Bezier path + arrow marker; basic selection ring |
| Types | `lib/workflows/types.ts` | `WorkflowNode`, `WorkflowEdge`, `NodeCategory` (15 categories) |
| Registry | `lib/workflows/node-registry.ts` | Defines `type`, `category`, `permission`, `configSchema`, `defaults` per node |
| Validation | `/api/workflows/{id}/validate` | Server-side validation of graph (not shown in detail) |
| Execution | `/api/workflows/{id}/run` | Runs the DAG; returns `nodeResults` |

---

## 2. Missing Pieces for Full Connectivity

A. **Connection Rules / Validation** — No client-side rule prevents invalid source→target pairings (e.g., `execution` → `trigger`). Edge creation is unfiltered.
B. **Data Flow Awareness** — Edges are visual only; users cannot see what data passes along an edge or which output port maps to which input.
C. **Edge Interaction** — Edges are selectable (selection ring exists) but have no click/heeler menu, no delete-on-click, no label, and no disable/enable toggle in the UI.
D. **Port Semantics** — Each node has one generic target (top) and one generic source (bottom). A mature studio needs named ports (`output_trade`, `input_signal`) so edges can represent typed data contracts.
E. **Connection Feedback** — During drag-to-connect, there is no preview of whether the connection is allowed, and no tooltip explaining *why* a connection is invalid.

---

## 3. UI Components Required

### 3.1 Connection Validation Overlay (`ConnectionValidator` / `useConnectionRules`)
- **Location:** `app/admin/intelligence/studio/connection-rules.ts` (new) + integrated into `studio-client.tsx`
- **Purpose:** Client-side guard on `onConnect`. Uses `lib/workflows/node-registry.ts` to check `category` of source/target nodes against allowed pairings.
- **UI:** When a user drags from a handle, show a floating tooltip near the mouse: green check if valid, red X + reason if invalid (e.g., “Execution nodes cannot feed into Trigger nodes”).

### 3.2 Enhanced Edge Component (`WfEdge` expanded + `WfEdgeLabel`)
- **Location:** `studio-client.tsx` (modify `WfEdge`) + new `components/workflows/edge-label.tsx`
- **Changes:**
  - Add `label` prop (derived from edge config or source/target node names) displaying above the midpoint.
  - Add `onClick` that opens a mini-inspector (inline) to toggle `enabled`, delete, or view data contract.
  - Add hover state that thickens stroke and shows endpoint nodes' names.
- **Styling:** Keep the existing `BaseEdge` + `getBezierPath`; layer SVG text for label with dark/readable background pill.

### 3.3 Named Port Handles (`WfPortHandle`)
- **Location:** New component `components/workflows/port-handle.tsx`; update `WfNode`
- **Purpose:** Replace the single top/bottom handle with multiple named handles (e.g., `output_signal`, `input_market_data`). Each handle gets a color + small label (rotated when vertical).
- **Connection impact:** `onConnect` now receives `sourceHandle` / `targetHandle` (already supported by ReactFlow `Connection`). We enforce that the handle names match allowed contracts.

### 3.4 Edge Context Menu (`EdgeContextMenu`)
- **Location:** `app/admin/intelligence/studio/edge-menu.tsx`
- **Content:**
  - Delete edge (with confirmation if it feeds an execution node)
  - Toggle enabled / disabled (sets `edge.enabled`; server validation uses this)
  - View data contract (summary of source output type → target input type)
  - Set custom label (optional user annotation)

### 3.5 Connection Inspector Panel (`Inspector` extension)
- **Location:** `app/admin/intelligence/studio/inspector.tsx` (already exists; extend)
- **Expansion:** When an edge is selected (`selectedId` extended to handle edges or new `selectedEdgeId` state), the inspector shows:
  - Source node name + output port
  - Target node name + input port
  - Data type / category mapping
  - Validation errors specific to the connection (e.g., “Risk node missing before execution” if edge skips risk)

### 3.6 Drag-to-Connect Preview (`ConnectionPreview`)
- **Location:** Integrated into `ReactFlow` `onConnectStart` / `onConnectEnd` / `onConnect` pipeline in `studio-client.tsx`
- **Visual:** While dragging, draw a temporary dashed line from handle to mouse with a label showing connection validity in real time.

---

## 4. Underlying Logic Required

### 4.1 Connection Rules Engine (`lib/workflows/connection-rules.ts` — new)
```ts
export interface ConnectionRule {
  sourceCategory: NodeCategory | "*";
  sourceHandle?: string;       // e.g., "output_trade"
  targetCategory: NodeCategory | "*";
  targetHandle?: string;       // e.g., "input_signal"
  allowed: boolean;
  reason?: string;             // shown in tooltip if denied
}

export const DEFAULT_CONNECTION_RULES: ConnectionRule[] = [
  // trigger -> anything (except execution before validation?)
  { sourceCategory: "trigger", targetCategory: "market_data", allowed: true },
  { sourceCategory: "market_data", targetCategory: "technical", allowed: true },
  { sourceCategory: "technical", targetCategory: "signal", allowed: true },
  { sourceCategory: "signal", targetCategory: "execution", allowed: true },
  { sourceCategory: "execution", targetCategory: "notification", allowed: true },
  // Block invalid flows
  { sourceCategory: "execution", targetCategory: "trigger", allowed: false, reason: "Execution cannot feed back into a trigger" },
];

export function isConnectionAllowed(
  sourceNode: WorkflowNode, sourceHandle: string,
  targetNode: WorkflowNode, targetHandle: string,
  rules: ConnectionRule[]
): { allowed: boolean; reason?: string } { ... }
```
- **Integration:** Call this inside `onConnect` in `studio-client.tsx`; if disallowed, do not call `addEdge` and trigger a toast message (using existing `notify`).

### 4.2 Data Contract Map (`lib/workflows/data-contracts.ts` — new)
- Define what each `category` outputs (e.g., `market_data` outputs `PriceSeries`; `signal` outputs `SignalEvent`;
- `execution` consumes `SignalEvent` + `RiskCheck`; `notification` consumes any).
- Used by `WfEdge` to render a small icon or tooltip showing the data type being passed.

### 4.3 Edge State Synchronization (`studio-client.tsx` updates)
- When an edge is toggled enabled/disabled or deleted via context menu, update both local `edges` state and the `WorkflowEdge` `enabled` field before save.
- Ensure `saveDraft` maps edge `enabled` back to the payload (currently it does not include `enabled`; add `enabled: (e.data as any)?.enabled ?? true`).

### 4.4 Execution Graph Traversal Update (`/api/workflows/{id}/run` — server-side reference)
- The server should traverse edges in topological order using `sourceHandle/targetHandle` if provided; if named ports are missing, fall back to generic source→target.
- When an edge is disabled (`enabled: false`), skip it in traversal. This is already implied by the `WorkflowEdge` definition but should be explicit.

---

## 5. Implementation Phases (Ordered)

### Phase 1 — Client-Side Guard + Visual Feedback (Day 1)
1. Create `lib/workflows/connection-rules.ts` with rules + `isConnectionAllowed()`.
2. Modify `studio-client.tsx`:
   - Update `onConnect` to call `isConnectionAllowed()` using node registry definitions (`getNodeDefinition`).
   - If denied: `notify("Invalid connection: ...", "err")`; do not add edge.
   - If allowed: `addEdge` as before, but add `sourceHandle`/`targetHandle` from connection if ports are named.
3. Add connection tooltip preview: use ReactFlow `ConnectionLine` or custom SVG overlay during drag.

### Phase 2 — Named Port Handles + Edge Labels (Day 2)
1. Build `components/workflows/port-handle.tsx` (styled handle with label).
2. Update `WfNode`: replace single handles with 1–3 handles based on `def.outputPorts` / `def.inputPorts` in registry (add to `WorkflowNodeDefinition` type).
3. Update `WfEdge`: add label display + hover thickening + click-to-select for inspector.

### Phase 3 — Edge Interaction + Inspector Extension (Day 3)
1. Build `edge-menu.tsx`; wire into edge click handler.
2. Extend `inspector.tsx`: when an edge is selected, render connection details and validation errors.
3. Add `enabled` toggle to `WorkflowEdge` save mapping.

### Phase 4 — Data Contract Awareness + Execution Alignment (Day 4)
1. Create `lib/workflows/data-contracts.ts` (contract definitions per category).
2. Integrate into `WfEdge` label / tooltip.
3. Verify server `/api/workflows/{id}/run` respects disabled edges and named ports (reference update if needed).

---

## 6. Key Files to Modify / Create

| File | Action |
|---|---|
| `lib/workflows/types.ts` | Add `outputPorts?: string[]`, `inputPorts?: string[]` to `WorkflowNodeDefinition`; add `enabled?: boolean` usage to `WorkflowEdge` |
| `lib/workflows/node-registry.ts` | Add `outputPorts` / `inputPorts` per node definition; optionally add `connectionRules` reference |
| `lib/workflows/connection-rules.ts` | **New** — rules engine |
| `lib/workflows/data-contracts.ts` | **New** — data type contracts |
| `app/admin/intelligence/studio/studio-client.tsx` | Modify `onConnect`, `WfNode`, state for edges, inspector selection |
| `app/admin/intelligence/studio/inspector.tsx` | Extend for edge selection |
| `components/workflows/port-handle.tsx` | **New** — named port UI |
| `app/admin/intelligence/studio/edge-menu.tsx` | **New** — context menu |

---

## 7. Success Criteria

- [ ] Users can drag from any output handle to any input handle; invalid connections are blocked with a message.
- [ ] Valid connections create selectable edges with visible labels.
- [ ] Clicking an edge opens interaction options (delete, toggle, view contract).
- [ ] The inspector shows connection details when an edge is selected.
- [ ] Disabled edges are preserved on save/load and respected during execution traversal.
- [ ] The graph validates both structurally (server) and visually (client) without disconnecting nodes unexpectedly.

---

*Plan version: 1.0 | Workspace: Trading Studio (`app/admin/intelligence/studio/`) | Engine: `@xyflow/react`*
