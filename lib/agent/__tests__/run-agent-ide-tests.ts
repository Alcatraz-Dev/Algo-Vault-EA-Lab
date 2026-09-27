import { runAgentIdeTests } from "./agent-ide.test";

runAgentIdeTests().then((passed) => {
    process.exit(passed ? 0 : 1);
}).catch((err) => {
    console.error(err);
    process.exit(1);
});
