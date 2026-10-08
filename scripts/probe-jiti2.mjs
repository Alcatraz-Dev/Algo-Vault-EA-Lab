import { createJiti } from "jiti";
import { resolve } from "node:path";

const cwd = process.cwd();
const jiti = createJiti(cwd, {
  tsconfigPaths: true,
  jsx: true,
  moduleCache: false,
  beforeLoad(filename, supervisor) {
    console.log("[probe] filename =", JSON.stringify(filename));
    console.log("[probe] includes firebase-admin:", filename.includes("firebase-admin"));
    return supervisor();
  },
});

jiti.import(resolve(cwd, "lib/candel/workspace/database.ts")).then(() => {
  console.log("loaded ok");
}).catch(e => console.log("ERR:", e.message));
