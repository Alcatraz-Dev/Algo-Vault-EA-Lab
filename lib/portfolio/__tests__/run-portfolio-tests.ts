import { runPortfolioTests } from "./portfolio-engines.test";

runPortfolioTests().then((ok) => {
    if (!ok) process.exitCode = 1;
}).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
