// scripts/post-build.cjs
const fs = require("fs");
const path = require("path");

const dist = path.join(__dirname, "..", "dist");
const srcPopup = path.join(dist, "src", "popup", "index.html");
const srcOptions = path.join(dist, "src", "options", "index.html");
const dstPopup = path.join(dist, "popup", "index.html");
const dstOptions = path.join(dist, "options", "index.html");

function moveFile(src, dst) {
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    fs.unlinkSync(src);
    console.log(`Moved ${src} -> ${dst}`);
  }
}

moveFile(srcPopup, dstPopup);
moveFile(srcOptions, dstOptions);

// Remove empty src directories
try {
  fs.rmdirSync(path.join(dist, "src", "popup"));
  fs.rmdirSync(path.join(dist, "src", "options"));
  fs.rmdirSync(path.join(dist, "src"));
} catch {
  // Ignore
}
