// Credential-free stub for the Firebase Admin SDK.
// The real firebase-admin package (node_modules/firebase-admin) ships an
// initializer that throws without full credentials. We replace it so the
// Candel SDK code can be imported with NO real credentials and NO network.
// The Candel authorization + database logic is the REAL application code.
//
// Surface required by lib/candel:
//   adminAuth.getUser(uid) -> { uid, customClaims? }
//   adminDatabase.ref(path) -> { get(), set(v), push(v), remove(), orderByChild() }

const TREE = new Map();

function ifNoneSet(node, path, value) {
  if (!node.has(path)) node.set(path, value);
}

function readTree(path) {
  if (path === "") return TREE;
  const segs = path.split("/").filter(Boolean);
  let cur = TREE;
  for (const s of segs) {
    const kv = cur.get(s);
    if (!kv) return undefined;
    cur = kv;
  }
  return cur;
}

function writeTree(path, value) {
  if (path === "") { TREE.clear(); TREE.set("__root__", value); return; }
  const segs = path.split("/").filter(Boolean);
  let cur = TREE;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i];
    if (!cur.has(s)) cur.set(s, new Map());
    cur = cur.get(s);
  }
  cur.set(segs[segs.length - 1], value);
}

function readObj(path) {
  const m = readTree(path);
  if (!m) return undefined;
  return Object.fromEntries(m);
}

function createSnapshot(path) {
  return {
    path,
    exists: () => readTree(path) !== undefined,
    val: () => readObj(path),
  };
}

function readOrdered(path) {
  const m = readTree(path);
  if (!m || !m instanceof Map) return [];
  return Array.from(m.entries()).map(([k, v]) => ({ key: k, val: () => v, exists: () => true }));
}

function writeObj(path, obj) {
  const segs = path.split("/").filter(Boolean);
  if (!segs.length) { TREE.clear(); TREE.set("__root__", obj); return; }
  const last = segs.pop();
  if (!last) { TREE.clear(); TREE.set("__root__", obj); return; }
  const parent = readTree(segs.join("/"));
  if (!parent) parent = new Map();
  if (!(parent instanceof Map)) parent = new Map();
  parent.set(last, obj);
  writeTree(segs.join("/"), parent);
}

function setLeaf(path, value) {
  const segs = path.split("/").filter(Boolean);
  if (!segs.length) { TREE.clear(); return; }
  const last = segs.pop();
  if (!last) { TREE.clear(); return; }
  const parent = readTree(segs.join("/"));
  if (!parent) parent = new Map();
  if (!(parent instanceof Map)) parent = new Map();
  parent.set(last, value);
  writeTree(segs.join("/"), parent);
}

function pushTo(path, value) {
  const segs = path.split("/").filter(Boolean);
  if (!segs.length) { TREE.clear(); return { key: "0" }; }
  const last = segs.pop();
  if (!last) { TREE.clear(); return { key: "0" }; }
  const parent = readTree(segs.join("/"));
  if (!parent || !(parent instanceof Map)) parent = new Map();
  const keys = Array.from(parent.keys()).filter(k => /^\d+$/.test(String(k)));
  const max = keys.length ? Math.max(...keys.map(Number)) : -1;
  const key = String(max + 1);
  parent.set(key, value);
  writeTree(segs.join("/"), parent);
  return { key };
}

function removeTree(path) {
  const segs = path.split("/").filter(Boolean);
  if (!segs.length) { TREE.clear(); return; }
  const last = segs.pop();
  if (!last) { TREE.clear(); return; }
  const parent = readTree(segs.join("/"));
  if (parent instanceof Map) parent.delete(last);
}

function orderByChildEqual(to, path) {
  // Mirrors the Candel database query: orderByChild("userId").equalTo(userId)
  const m = readTree(path);
  if (!m || !(m instanceof Map)) return { val: () => [] };
  const out = [];
  for (const [k, v] of m) {
    const entry = typeof v === "object" && v !== null ? v : {};
    const child = entry[to];
    if (child !== undefined && child !== null && String(child) === String(to)) {
      out.push({ key: k, val: () => v, exists: () => true });
    }
  }
  return { val: () => (Array.isArray(out) ? out : []) };
}

function createRef(path) {
  return {
    get: () => createSnapshot(path),
    set: (v) => { setLeaf(path, v); return Promise.resolve(); },
    push: (v) => pushTo(path, v).then(({ key }) => ({ key })),
    remove: () => { removeTree(path); return Promise.resolve(); },
    orderByChild: (to) => new RefOrdered(path, to),
    on: (event, cb) => {
      const full = path + (event === "value" ? ".value" : "");
      const handler = { event, cb, next: null };
      if (!TREE.has("_listeners")) TREE.set("_listeners", new Map());
      let head = TREE.get("_listeners").get(full) ?? null;
      TREE.get("_listeners").set(full, handler);
      return { off: () => {
        const l = TREE.get("_listeners");
        if (l) {
          let h = l.get(full);
          if (h === head) l.set(full, h.next);
        }
      } };
    },
  };
}

function createRefOrdered(path, to) {
  return {
    equalTo: (value) => {
      const val = orderByChildEqual(to, path).val();
      return { val: () => val };
    },
  };
}

const adminAuth = {
  getAuth: () => adminAppRef,
  initialize: () => {},
};
const adminAppRef = { name: "[candel-test-fake-auth]" };
const adminDatabase = {
  ref: (path) => createRef(path),
};

// Re-export the exact named bindings the Candel codebase imports.
export const adminAuth = adminAuth;
export const adminDatabase = adminDatabase;
export const initializeApp = () => adminAppRef;
export const getApps = () => [adminAppRef];
export const cert = () => ({});

console.log("[candel-test] firebase-admin stub loaded (no credentials, no network)");
