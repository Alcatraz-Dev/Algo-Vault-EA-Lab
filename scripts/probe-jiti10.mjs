import { createJiti } from "jiti";
import { resolve } from "node:path";

const cwd = process.cwd();

const jiti = createJiti(cwd, {
  tsconfigPaths: true,
  jsx: true,
  moduleCache: false,
  beforeLoad(filename, supervisor) {
    console.log("[probe] beforeLoad:", filename);
    if (filename.includes("firebase-admin") || filename.includes("lib/firebase-admin")) {
      console.log("[probe]   INTERVENTION");
      return {
        source: `
          export const adminAuth = { getUser: (uid) => Promise.resolve({ uid }), getAuth: () => ({}) };
          export const adminDatabase = { ref: () => ({ get: () => ({ val: () => ({}) }), set: ()=>{}, push: ()=>({key:'1'}), remove: ()=>{} }) };
          export const adminApp = {};
          export const getApps = () => [{ name: "t" }];
          export const initializeApp = () => ({ name: "t" });
          export const cert = () => ({});
          export const getApp = () => ({ name: "t" });
          export const getAuth = (app) => adminAuth;
          export const getDatabase = (app) => adminDatabase;
        `,
      };
    }
    return supervisor();
  },
});

jiti.import(resolve(cwd, "lib/candel/workspace/database.ts")).then(() => {
  console.log("loaded ok");
}).catch(e => console.log("ERR:", e.message, "\n", e.stack.split("\n").slice(0,6).join("\n")));
