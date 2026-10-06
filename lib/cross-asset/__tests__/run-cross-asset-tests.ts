import { runCrossAssetTests } from "./cross-asset.test";

runCrossAssetTests()
    .then((ok) => {
        if (!ok) process.exitCode = 1;
    })
    .catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
    });
