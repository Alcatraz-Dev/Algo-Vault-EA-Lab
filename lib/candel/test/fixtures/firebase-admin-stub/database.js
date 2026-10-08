// Stub firebase-admin/database surface (in-memory RTDB-like, path-based).
// Mirrors the data-get/set/push/remove semantics the Firebase Admin SDK
// exposes for Realtime Database, but keeps everything in-memory.

const listeners = new Map(); // path -> callback (for on("value"))

function readTree() {
  const root = {};
  function walk(node, map) {
    for (const [k, v] of map) {
      if (v instanceof Map) {
        node[k] = {};
        walk(node[k], v);
      } else {
        node[k] = v;
      }
    }
  }
  walk(root, this._tree);
  return root;
}

function setTree(path, value) {
  const segs = path.split("/").filter(Boolean);
  let node = this._tree;
  for (let i = 0; i < segs.length - 1; i++) {
    if (!(segs[i] in node)) node[segs[i]] = {};
    node = node[segs[i]];
  }
  node[segs[segs.length - 1]] = value;
  // Notify listeners
  const key = path + ".value";
  const cb = listeners.get(key);
  if (cb) cb({ key, val: () => value, exists: () => true });
}

function get(path) {
  const segs = path.split("/").filter(Boolean);
  let node = this._tree;
  for (const seg of segs) {
    if (node == null || !(seg in node)) return { exists: () => false, val: () => null };
    node = node[seg];
  }
  return { exists: () => true, val: () => node };
}

function push(path, value) {
  const segs = path.split("/").filter(Boolean);
  let node = this._tree;
  for (let i = 0; i < segs.length - 1; i++) {
    if (!(segs[i] in node)) node[segs[i]] = {};
    node = node[segs[i]];
  }
  // Generate a numeric key (mirror real RTDB push).
  const existing = Object.keys(node).filter(k => /^\d+$/.test(k));
  const key = existing.length > 0
    ? Math.max(...existing.map(Number)) + 1 + ""
    : "0";
  node[key] = value;
  const full = path + "/" + key;
  const cb = listeners.get(full + ".value");
  if (cb) cb({ key, val: () => value, exists: () => true });
  return { key };
}

function remove(path) {
  const segs = path.split("/").filter(Boolean);
  let node = this._tree;
  for (let i = 0; i < segs.length - 1; i++) {
    if (node == null || !(segs[i] in node)) return;
    node = node[segs[i]];
  }
  delete node[segs[segs.length - 1]];
  const cb = listeners.get(path + ".value");
  if (cb) cb({ key: "", val: () => null, exists: () => false });
}

function ref(path) {
  return {
    get: () => get.call(this, path),
    set: (v) => setTree.call(this, path, v),
    push: (v) => push.call(this, path, v),
    remove: () => remove.call(this, path),
    orderByChild: () => refOrdered.call(this, path),
    on: (event, cb) => {
      const full = path + (event === "value" ? ".value" : "");
      listeners.set(full, cb);
      return { off: () => listeners.delete(full) };
    },
  };
}

function refOrdered(path) {
  const keys = [];
  const values = [];
  function walk(node, currentPath) {
    for (const [k, v] of Object.entries(node)) {
      if (v instanceof Map) {
        walk(v, currentPath + "/" + k);
      } else {
        keys.push(k);
        values.push(v);
      }
    }
  }
  walk(this._tree, path);
  return {
    equalTo: (value) => {
      const idx = keys.findIndex((k, i) => {
        return values[i] !== undefined && String(values[i]) === String(value);
      });
      if (idx === -1) return { val: () => [] };
      return { val: () => [values[idx]] };
    },
  };
}

export const database = {
  ref,
  get: (path) => ref.call({ _tree: {} }, path).get(path),
  set: (path, v) => setTree.call({ _tree: {} }, path, v),
  push: (path, v) => push.call({ _tree: {} }, path, v),
  remove: (path) => remove.call({ _tree: {} }, path),
  orderByChild: () => ({ equalTo: () => ({ val: () => [] }) }),
};
