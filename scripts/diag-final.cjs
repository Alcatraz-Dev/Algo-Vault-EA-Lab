const { createJiti } = require("jiti");
const path = require("path");
const jiti = createJiti(__filename, { alias: { "@": path.join(__dirname, "..") + "/" } });

(async () => {
    const { defaultRouter } = await jiti.import(path.join(__dirname, "..", "lib/ai/router.ts"));
    const res = await defaultRouter.chat({
        messages: [{ role: "user", content: "Reply with the single word: pong" }],
        systemPrompt: "You are a ping responder returning only pong.",
    });
    console.log("final provider:", res.provider);
    console.log("model:", res.model);
    console.log("content:", res.content.slice(0, 80));
})().catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
});