// AI account observability runner (ESM entry -> jiti -> fixture).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
require("../lib/ai/__tests__/ai-obs.fixture.ts");
