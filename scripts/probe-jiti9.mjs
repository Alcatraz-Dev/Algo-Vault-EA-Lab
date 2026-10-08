import { createJiti } from "jiti";
import { resolve } from "node:path";

const jiti = createJiti(process.cwd(), { moduleCache: false });

// jiti's TypeScript loader is the one that does the loading.
// Let's inspect the default config
console.log("default options:", JSON.stringify(jiti._options, null, 2).slice(0, 500));
console.log("keys:", Object.keys(jiti).join(", "));
