import { createJiti } from "jiti";
import { resolve } from "node:path";

const cwd = process.cwd();
const jiti = createJiti(cwd, {
  tsconfigPaths: true,
  jsx: true,
  moduleCache: false,
  beforeLoad(filename, supervisor) {
    console.log("[probe] filename =", filename);
    if (filename.includes("firebase-admin")) {
      return {
        source: `
          export const adminAuth = { getAuth: () => ({ getUid: () => "test-user" }) };
          export const adminDatabase = { ref: () => ({ get: () => ({ val: () => ({}) }), set: () => {}, push: () => ({ key: "x" }), remove: () => {} }) };
          export const adminApp = {};
        `,
      };
    }
    return supervisor();
  },
});

jiti.import(resolve(cwd, "lib/candel/workspace/database.ts")).then(() => {
  console.log("loaded ok");
}).catch(e => console.log("ERR:", e.message));
