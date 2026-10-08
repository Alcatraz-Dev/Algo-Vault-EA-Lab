import { createJiti } from "jiti";
console.log("jiti version:", require("./node_modules/jiti/package.json").version);
const jiti = createJiti(process.cwd(), {
  // default options
  moduleCache: false,
  // ESM
  esm: true,
  // experimental ts
  ts: true,
});

// List all known hook options by trying
const options = {
  beforeLoad: (filename, supervisor) => {
    console.log("beforeLoad called:", filename);
    return supervisor();
  },
  onLoad: (filename, resolvePath, context) => {
    console.log("onLoad called:", filename);
    return context.defaultLoad(filename, resolvePath);
  },
};
// Just use default, but wrap by accessing jiti._load
const j = createJiti(process.cwd(), { moduleCache: false });
console.log("jiti keys:", Object.keys(j).filter(k => k.startsWith('_')).join(', '));
