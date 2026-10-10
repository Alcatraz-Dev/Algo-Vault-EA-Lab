/**
 * lib/candel/test/fake-firebase-admin.ts
 *
 * Fake `firebase-admin` surface used ONLY by the Candel SDK verification
 * harness (tests/lib/candel/). It re-implements the RTDB path contract but
 * drives the REAL Candel application logic (authorization, permissions,
 * database persistence) — never the Candel security checks themselves.
 *
 * Replicates the named bindings the Candel codebase imports:
 *   adminDatabase.ref(path).get()/set()/push()/remove()/orderByChild...
 *   adminAuth.getUser(uid)...
 *
 * No production Firebase credentials are used; no live network. All reads/
 * writes land in the in-memory tree (lib/candel/test/rtdb.ts) with the real
 * Candel code on top.
 */

import { adminDatabase as realAdminDatabase } from "@/lib/firebase-admin";
import { adminAuth as realAdminAuth } from "@/lib/firebase-admin";
import {
  getCandelInstance,
  getCandelInstancesByUser,
  saveCandelInstance,
  deleteCandelInstance,
  saveCandelTemplate,
  getCandelTemplate,
  saveCandelAccountBindings,
  getCandelAccountBindings,
  getCandelPermissions,
  saveCandelPermissions,
  getCandelConversations,
  saveCandelConversation,
  deleteCandelConversation,
  getCandelMemory,
  saveCandelMemoryEntry,
  deleteCandelMemoryEntry,
  getCandelActivity,
  saveCandelActivity,
  getCandelApprovals,
  saveApprovalRequest,
  deleteApprovalRequest,
  getCandelJobs,
  saveCandelJob,
  deleteCandelJob,
  getCandelAutomations,
  saveCandelAutomation,
  deleteCandelAutomation,
  getCandelToolCalls,
  saveCandelToolCall,
  getCandelProposals,
  saveCandelProposal,
  deleteCandelProposal,
  getCandelWorkspacePages,
  saveCandelWorkspacePage,
  deleteCandelWorkspacePage,
  getCandelAccountContext,
  saveCandelAccountContext,
} from "@/lib/candel/workspace/database";
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
import { FakeRtdb, createFakeRtdb, FakeSnapshot } from "@/lib/candel/test/rtdb";

// ─── Per-Test RTDB container ────────────────────────────────────────────────

let currentTree: FakeRtdb | null = null;
let currentAuth: FakeAdminAuth | null = null;

/** Point the fake admin surface at a tree/auth pair (not a React hook). */
export function installFakeRtdb(tree: FakeRtdb, auth: FakeAdminAuth) {
  currentTree = tree;
  currentAuth = auth;
}

export function resetFakeRtdb() {
  if (currentTree) currentTree.reset();
}

/** Setup the fake Firebase harness for a Candel test. */
export function setupHarness() {
  const tree = new FakeRtdb();
  const auth = new FakeAdminAuth("test-user");
  installFakeRtdb(tree, auth);
  return {
    tree,
    auth,
    dispose: () => installFakeRtdb(new FakeRtdb(), new FakeAdminAuth("test-user")),
  };
}

/** Query order-by-child helper (orderByChild().equalTo()). */
export class FakeQueryOrder {
  constructor(public tree: FakeRtdb, public path: string) {}

  equalTo(value: string | number): { val(): unknown; get(): FakeSnapshot } {
    const all = this.tree.ref(this.path).val();
    const array = Array.isArray(all) ? all : [];
    const filtered = array.filter((entry: Record<string, unknown>) => {
      if (typeof entry !== "object" || entry === null) return false;
      const child = (entry as Record<string, unknown>)[String(value)];
      return child !== undefined && child !== null && String(child) === String(value);
    });
    return {
      val: () => filtered,
      // Return a FakeSnapshot so the real database code's .get().exists() and
      // .get().val() work against the in-memory tree.
      get: () => new FakeSnapshot(this.tree, this.path),
    };
  }
}

/** Real adminDatabase surface (used by routes when real Firebase is
 * available); replaced by the harness. */

// ─── FakeAuth (server-side identity) ────────────────────────────────────────

export class FakeAdminAuth {
  constructor(private _uid: string) {}

  get uid(): string {
    return this._uid;
  }

  async getUser(): Promise<{ uid: string; customClaims?: { admin?: boolean; role?: string } }> {
    if (this._uid === "unauthorized") throw new Error("Auth error");
    return { uid: this._uid, customClaims: this._uid === "admin-user" ? { admin: true } : undefined };
  }
}

// ─── Fake RTDB snapshot surface ─────────────────────────────────────────────

export class FakeDatabaseRef {
  constructor(public tree: FakeRtdb, public path: string) {}

  get(): FakeSnapshot {
    return this.tree.ref(this.path).val();
  }

  set(value: unknown): Promise<void> {
    this.tree.set(this.path, value);
    return Promise.resolve();
  }

  push(value: unknown): Promise<{ key: string }> {
    // Mirror the real Candel database.push-style writes (save*CamelCase
    // functions). We route to the corresponding real function so the real
    // security/canonical logic executes.
    return this._routePush(value);
  }

  orderByChild(): FakeQueryOrder {
    return new FakeQueryOrder(this.tree, this.path);
  }

  remove(): Promise<void> {
    this.tree.remove(this.path);
    return Promise.resolve();
  }

  private async _routePush(value: unknown): Promise<{ key: string }> {
    // Route to the real Candel save function based on the path prefix.
    const p = this.path;
    if (p.startsWith("candel/")) {
      const instance = value as CandelInstance;
      await saveCandelInstance(instance);
      return { key: instance.id };
    }
    if (p.startsWith("candelTemplates/")) {
      const t = value as CandelTemplate;
      await saveCandelTemplate(t);
      return { key: t.id };
    }
    if (p.startsWith("candelAccountBindings/")) {
    const binding = value as AccountBinding;
    const tradingAccountId = binding.tradingAccountId;
    await saveCandelAccountBindings(tradingAccountId, tradingAccountId, [binding]);
      return { key: binding.tradingAccountId };
    }
    if (p.startsWith("candelPermissions/")) {
      const perms = value as CandelPermissions;
      // key is userId/candelId ...
      return { key: "" };
    }
    if (p.startsWith("candelConversations/")) {
      const conv = value as CandelConversation;
      await saveCandelConversation(conv);
      return { key: conv.id };
    }
    if (p.startsWith("candelMemory/")) {
      const mem = value as CandelMemoryEntry;
      await saveCandelMemoryEntry(mem);
      return { key: mem.id };
    }
    if (p.startsWith("candelActivity/")) {
      const act = value as CandelActivity;
      await saveCandelActivity(act);
      return { key: act.id };
    }
    if (p.startsWith("candelApprovals/")) {
      const a = value as CandelApprovalRequest;
      await saveApprovalRequest(a);
      return { key: a.id };
    }
    if (p.startsWith("candelAutomation/")) {
      const auto = value as CandelAutomation;
      await saveCandelAutomation(auto);
      return { key: auto.id };
    }
    if (p.startsWith("candelToolCalls/")) {
      const tc = value as CandelToolCall;
      await saveCandelToolCall(tc);
      return { key: tc.id };
    }
    if (p.startsWith("candelProposals/")) {
      const prop = value as CandelProposal;
      await saveCandelProposal(prop);
      return { key: prop.id };
    }
    if (p.startsWith("candelWorkspace/")) {
      const page = value as CandelPage;
      await saveCandelWorkspacePage(page);
      return { key: page.id };
    }
    if (p.startsWith("candelAccountContext/")) {
      const ctx = value as CandelAccountContext;
      // CandelAccountContext has no candelId/userId fields; derive them from the RTDB path.
      const segs = p.split("/").filter(Boolean);
      // segs: [candelAccountContext, userId, candelId, accountId]
      const candelId = segs[2] ?? "";
      const userId = segs[1] ?? "";
      await saveCandelAccountContext(candelId, userId, ctx.accountId, ctx);
      return { key: ctx.accountId };
    }
    // Fallback: store directly in the tree (non-Candel RTDB paths).
    this.tree.ref(p).set(value);
    return { key: "" };
  }
}


/** Runtime replacement for `adminDatabase.ref(path)` used by the harness. */
export function ref(path: string): FakeDatabaseRef {
  const fakeRef = new FakeDatabaseRef(currentTree!, path);
  // Augment the ref with a `.get()` method that returns a FakeSnapshot.
  // The real database code chains: ref(path).orderByChild().equalTo().get()
  // so the query result must also be a FakeSnapshot.
  const originalGet = fakeRef.get.bind(fakeRef);
  Object.defineProperty(fakeRef, "get", {
    value: function get(): FakeSnapshot {
      const snap = originalGet();
      if (snap instanceof FakeSnapshot) return snap;
      // If get() is called directly (not via orderByChild), wrap in a snapshot.
      return new FakeSnapshot(fakeRef.tree, fakeRef.path);
    },
    writable: false,
    configurable: false,
  });
  return fakeRef;
}
