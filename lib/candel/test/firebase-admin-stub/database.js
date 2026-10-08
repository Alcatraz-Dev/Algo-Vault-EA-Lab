// Stub firebase-admin/database surface (in-memory RTDB-like, path-based).
// Mirrors the data-get/set/push/remove semantics the Firebase Admin SDK
// exposes for Realtime Database, but keeps everything in-memory.
//
// The tree is SHARED across all ref() calls so that set()/push()/remove()
// and orderByChild()/equalTo().get() see the same data (mirrors the real
// Firebase RTDB, where all paths live under one global store).

const listeners = new Map();

// Shared global tree (mirrors the real Firebase RTDB).
const globalTree = {};

function getRaw(path, tree) {
  const segs = path.split("/").filter(Boolean);
  let node = tree;
  for (const seg of segs) {
    if (node == null || !(seg in node)) return { exists: () => false, val: () => null };
    node = node[seg];
  }
  return { exists: () => true, val: () => node };
}

function setTree(path, value) {
  const segs = path.split("/").filter(Boolean);
  let node = globalTree;
  for (let i = 0; i < segs.length - 1; i++) {
    if (!(segs[i] in node)) node[segs[i]] = {};
    node = node[segs[i]];
  }
  node[segs[segs.length - 1]] = value;
  const key = path + ".value";
  const cb = listeners.get(key);
  if (cb) cb({ key, val: () => value, exists: () => true });
}

function push(path, value) {
  const segs = path.split("/").filter(Boolean);
  let node = globalTree;
  for (let i = 0; i < segs.length - 1; i++) {
    if (!(segs[i] in node)) node[segs[i]] = {};
    node = node[segs[i]];
  }
  const existing = Object.keys(node).filter(k => /^\d+$/.test(k));
  const key = existing.length > 0 ? Math.max(...existing.map(Number)) + 1 + "" : "0";
  node[key] = value;
  const full = path + "/" + key;
  const cb = listeners.get(full + ".value");
  if (cb) cb({ key, val: () => value, exists: () => true });
  return { key };
}

function remove(path) {
  const segs = path.split("/").filter(Boolean);
  let node = globalTree;
  for (let i = 0; i < segs.length - 1; i++) {
    if (node == null || !(segs[i] in node)) return;
    node = node[segs[i]];
  }
  delete node[segs[segs.length - 1]];
  const cb = listeners.get(path + ".value");
  if (cb) cb({ key: "", val: () => null, exists: () => false });
}

function makeQuery(holder, child, filterValue) {
  const filteredMap = {};
  if (filterValue !== undefined && filterValue !== null) {
    for (const [k, v] of Object.entries(holder._tree)) {
      if (v !== undefined && String(v) === String(filterValue)) {
        filteredMap[k] = v;
      }
    }
  }
  return {
    _tree: holder._tree,
    path: holder.path,
    child,
    equalTo: (value) => {
      const nextFilter = value !== undefined ? value : filterValue;
      return makeQuery(holder, child, nextFilter);
    },
    get: () => {
      const snap = getRaw(holder.path, holder._tree);
      return Promise.resolve(snap);
    },
  };
}

function makeRef(path, tree) {
  const holder = { _tree: tree, path };
  return {
    ...holder,
    get: () => getRaw(path, tree),
    set: (v) => setTree.call(holder, path, v),
    push: (v) => push.call(holder, path, v),
    remove: () => remove.call(holder, path),
    orderByChild: (child) => makeQuery(holder, child),
    on: (event, cb) => {
      const full = path + (event === "value" ? ".value" : "");
      listeners.set(full, cb);
      return { off: () => listeners.delete(full) };
    },
  };
}

const database = {
  ref(path) {
    return makeRef(path, globalTree);
  },
  get: (path) => {
    const snap = getRaw(path, globalTree);
    return Promise.resolve(snap);
  },
  set: (path, v) => setTree.call({ _tree: globalTree }, path, v),
  push: (path, v) => push.call({ _tree: globalTree }, path, v),
  remove: (path) => remove.call({ _tree: globalTree }, path),
  orderByChild: (path, child) => makeRef(path, globalTree).orderByChild(child),
  on: (path, event, cb) => {
    const full = path + (event === "value" ? ".value" : "");
    listeners.set(full, cb);
    return { off: () => listeners.delete(full) };
  },
};

function getDatabase(app) {
  return database;
}

// Reset for test isolation
function reset() {
  globalTree = {};
}
module.exports = { database, getDatabase, reset };

console.log("[candel-test] firebase-admin/database stub loaded (no credentials, no network)");
