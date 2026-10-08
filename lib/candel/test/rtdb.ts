/**
 * lib/candel/test/rtdb.ts
 *
 * In-memory stand-in for the Firebase Realtime Database surface that the
 * Candel SDK and its routes read/write. Replicates the exact RTDB key paths +
 * query semantics the SDK uses (path-based get/set/push/remove + the
 * orderByChild().equalTo() lookups), while leaving the REAL Candel application
 * logic (authorization, permissions, database persistence) entirely on top.
 *
 * Nothing here is the Candel security logic. It is a transport shim only.
 */

import type {
  CandelInstance,
  CandelTemplate,
  AccountBinding,
  CandelPermissions,
  CandelConversation,
  CandelMemoryEntry,
  CandelActivity,
  CandelApprovalRequest,
  CandelJob,
  CandelAutomation,
  CandelToolCall,
  CandelProposal,
  CandelPage,
  CandelAccountContext,
} from "@/lib/candel/types";

/** In-memory RTDB tree: path segment keys -> value.
 *  Leaf values are either a primitive/object snapshot (for .get().val()) or
 *  an ordered list of index->value entries (for .orderByChild().equalTo()
 *  lookup). */
export class FakeRtdb {
  private root: Map<string, unknown> = new Map();

  getNode(path: string): Map<string, unknown> {
    const segs = path.split("/").filter(Boolean);
    let node: Map<string, unknown> = this.root;
    for (const seg of segs) {
      if (!node.has(seg)) node.set(seg, new Map());
      node = node.get(seg) as Map<string, unknown>;
    }
    return node;
  }

  readNode(path: string): Map<string, unknown> | undefined {
    const segs = path.split("/").filter(Boolean);
    let node: Map<string, unknown> | undefined = this.root;
    for (const seg of segs) {
      if (!node || !node.has(seg)) return undefined;
      node = node.get(seg) as Map<string, unknown>;
    }
    return node;
  }

  /** ref(path) — returns a snapshot holder. */
  ref(path: string): FakeSnapshot {
    return new FakeSnapshot(this, path);
  }

  /** Check whether a path exists in the tree. */
  has(path: string): boolean {
    return this.readNode(path) !== undefined;
  }

  /** Serialize the whole tree to a plain object for assertions. */
  serialize(): Record<string, unknown> {
    return this._serialize(this.root as unknown as Map<string, unknown>);
  }

  /** Serialize a node to a plain object (used by snapshot().val()). */
  _serialize(node: Map<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of node) {
      if (v instanceof Map) {
        const inner = this._serialize(v);
        if (Object.keys(inner).length > 0) out[k] = inner;
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  /** Clear the whole tree (test reset). */
  reset(): void {
    this.root = new Map();
  }

  /** Set a leaf value at a path in the tree. */
  set(path: string, value: unknown): void {
    const segs = path.split("/").filter(Boolean);
    let node: Map<string, unknown> = this.root;
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i];
      if (!node.has(seg)) node.set(seg, new Map());
      node = node.get(seg) as Map<string, unknown>;
    }
    node.set(segs[segs.length - 1], value);
  }

  /** Remove a node at a path from the tree. */
  remove(path: string): void {
    const segs = path.split("/").filter(Boolean);
    let node: Map<string, unknown> = this.root;
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i];
      if (!node.has(seg)) return;
      node = node.get(seg) as Map<string, unknown>;
    }
    node.delete(segs[segs.length - 1]);
  }
}

/** Snapshot returned by ref().get() — mirrors the Firebase Admin
 * `DataSnapshot` contract (.exists(), .val()). */
export class FakeSnapshot {
  constructor(
    private db: FakeRtdb,
    private path: string,
  ) {}

  exists(): boolean {
    return this.db.readNode(this.path) !== undefined;
  }

  set(value: unknown): void {
    this.db.set(this.path, value);
  }

  remove(): void {
    this.db.remove(this.path);
  }

  val<T = unknown>(): T {
    const node = this.db.readNode(this.path);
    if (node === undefined) return undefined as T;
    // Ordered list (orderByChild) -> reconstruct array
    if (Array.isArray(node)) {
      return node as unknown as T;
    }
    // Map -> serialize
    if (node instanceof Map) {
      return this.db._serialize(node) as T;
    }
    return node as unknown as T;
  }
}

export interface QuerySnapshot {
  exists(): boolean;
  val<T = unknown>(): T;
}

export interface FakeQuery {
  equalTo(value: string | number): QuerySnapshot;
}

export function createFakeRtdb(): { rtdb: FakeRtdb; reset: () => void } {
  const rtdb = new FakeRtdb();
  return { rtdb, reset: () => rtdb.reset() };
}
