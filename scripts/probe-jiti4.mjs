import { createJiti } from "jiti";
import { resolve } from "node:path";

const cwd = process.cwd();

// Simple jiti with default config, no tsconfigPaths
const jiti = createJiti(cwd, { moduleCache: false });

// Simulate importing firebase-admin directly
jiti.import(resolve(cwd, "node_modules/firebase-admin/lib/app/index.js")).then(() => {
  console.log("ok");
}).catch(e => console.log("ERR:", e.message));
