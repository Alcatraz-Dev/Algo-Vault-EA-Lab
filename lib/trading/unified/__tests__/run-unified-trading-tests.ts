import { runUnifiedTradingTests } from "./unified-trading.test";

runUnifiedTradingTests()
    .then((ok) => {
        if (!ok) process.exitCode = 1;
    })
    .catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
    });