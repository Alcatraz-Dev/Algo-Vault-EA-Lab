import { createJiti } from "jiti";
import { resolve } from "node:path";

const cwd = process.cwd();

const jiti = createJiti(cwd, {
  tsconfigPaths: true,
  jsx: true,
  moduleCache: false,
  onLoad(filename, resolvePath, context) {
    console.log("[probe] onLoad filename =", filename);
    if (filename.includes("firebase-admin") || filename.includes("lib/firebase-admin")) {
      console.log("[probe]   -> intercepted");
      return {
        source: `
          export const adminAuth = { getAuth: () => ({ getUid: () => "test-user" }) };
          export const adminDatabase = { ref: () => ({ get: () => ({ val: () => ({}) }), set: () => {}, push: () => ({ key: "x" }), remove: () => {} }) };
          export const adminApp = {};
          export function getApps(){ return [{ name: "test" }]; }
          export function initializeApp(){} export function cert(){ return {}; }
          export const getAuth = () => ({ getUid: () => "test-user" });
          export const getDatabase = () => ({ ref: () => ({}) });
        `,
      };
    }
    return context.defaultLoad(filename, resolvePath);
  },
});

jiti.import(resolve(cwd, "lib/candel/workspace/database.ts")).then(() => {
  console.log("loaded ok");
}).catch(e => console.log("ERR:", e.message));
