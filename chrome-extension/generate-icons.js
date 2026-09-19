// Generate simple PNG icons for the Chrome extension
// Run: node generate-icons.js

const { createCanvas } = require("canvas");
const fs = require("fs");
const path = require("path");

const sizes = [16, 32, 48, 128];
const outDir = path.join(__dirname, "public", "icons");

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

for (const size of sizes) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#7c3aed";
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, size * 0.2);
  ctx.fill();

  // Lightning bolt
  ctx.fillStyle = "#ffffff";
  const s = size / 128;
  ctx.beginPath();
  ctx.moveTo(70 * s, 10 * s);
  ctx.lineTo(45 * s, 55 * s);
  ctx.lineTo(65 * s, 55 * s);
  ctx.lineTo(50 * s, 118 * s);
  ctx.lineTo(95 * s, 50 * s);
  ctx.lineTo(70 * s, 50 * s);
  ctx.closePath();
  ctx.fill();

  const buffer = canvas.toBuffer("image/png");
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), buffer);
  console.log(`Created icon${size}.png`);
}

console.log("All icons generated!");
