// Generates the promo-tile source HTML with the real AlgoVault logo inlined.
// Run: node src/build-tiles.mjs   (from chrome-extension/store-assets/)
// Then screenshot each HTML at its exact size with headless Chrome:
//
//   chrome --headless=new --hide-scrollbars \
//     --window-size=440,280 --screenshot=../tiles/small-440x280.png tile-small.html
//   chrome --headless=new --hide-scrollbars \
//     --window-size=1400,560 --screenshot=../tiles/marquee-1400x560.png tile-marquee.html
//
// Design follows developer.chrome.com/docs/webstore/images: brand-first,
// minimal text, full-bleed saturated field, defined edges. The candlestick
// motif is abstract brand art (no axes, numbers, or performance claims).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const logoB64 = readFileSync(resolve(dir, "..", "..", "public", "logos", "logo.png")).toString("base64");
const logoUri = `data:image/png;base64,${logoB64}`;

// Abstract decorative candles — soft, clearly non-data (no grid/axes/labels).
const candles = `
<svg class="chart" viewBox="0 0 400 200" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <g opacity="0.5">
    <line x1="40" y1="60" x2="40" y2="150" stroke="#52525b" stroke-width="3"/>
    <rect x="30" y="85" width="20" height="40" rx="2" fill="#fb7185" opacity="0.75"/>
    <line x1="95" y1="40" x2="95" y2="130" stroke="#52525b" stroke-width="3"/>
    <rect x="85" y="60" width="20" height="45" rx="2" fill="#34d399" opacity="0.75"/>
    <line x1="150" y1="55" x2="150" y2="160" stroke="#52525b" stroke-width="3"/>
    <rect x="140" y="90" width="20" height="45" rx="2" fill="#34d399" opacity="0.75"/>
    <line x1="205" y1="30" x2="205" y2="120" stroke="#52525b" stroke-width="3"/>
    <rect x="195" y="50" width="20" height="45" rx="2" fill="#34d399" opacity="0.85"/>
    <line x1="260" y1="45" x2="260" y2="140" stroke="#52525b" stroke-width="3"/>
    <rect x="250" y="70" width="20" height="45" rx="2" fill="#fb7185" opacity="0.7"/>
    <line x1="315" y1="25" x2="315" y2="110" stroke="#52525b" stroke-width="3"/>
    <rect x="305" y="40" width="20" height="45" rx="2" fill="#34d399" opacity="0.9"/>
    <line x1="365" y1="35" x2="365" y2="100" stroke="#52525b" stroke-width="3"/>
    <rect x="355" y="48" width="20" height="38" rx="2" fill="#34d399" opacity="0.9"/>
  </g>
  <polyline points="20,150 80,125 140,135 200,100 260,110 320,70 380,55"
    fill="none" stroke="#ff4d00" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const css = (scale) => `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; }
  body {
    background: #0f0f0f;
    color: #f9f9f9;
    font-family: Inter, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
    position: relative;
  }
  .glow {
    position: absolute; inset: 0; pointer-events: none;
    background:
      radial-gradient(60% 90% at 85% 10%, rgba(255,77,0,0.28), transparent 60%),
      radial-gradient(50% 70% at 8% 95%, rgba(255,77,0,0.12), transparent 60%);
  }
  .chart { position: absolute; right: 0; bottom: 0; height: 72%; opacity: 0.9; }
  .brand { position: absolute; display: flex; align-items: center; }
  .brand img { display: block; filter: drop-shadow(0 0 ${10 * scale}px rgba(255,77,0,0.45)); }
  .wordmark { font-weight: 800; letter-spacing: -0.02em; line-height: 1; }
  .wordmark .vault { color: #ff4d00; }
  .caption {
    text-transform: uppercase; color: #a3a3a3;
    letter-spacing: 0.32em; font-weight: 600;
  }
  .tagline { color: #d4d4d8; font-weight: 500; }
`;

function page({ w, h, logo, name, caption, tagline, pad, gap }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${css(pad / 28)}</style></head>
<body style="width:${w}px;height:${h}px">
  <div class="glow"></div>
  ${candles}
  <div class="brand" style="left:${pad}px;top:${pad}px;gap:${gap}px">
    <img src="${logoUri}" width="${logo}" height="${logo}" alt="">
    <div>
      <div class="wordmark" style="font-size:${name}px">Algo<span class="vault">Vault</span></div>
      <div class="caption" style="font-size:${caption}px;margin-top:${Math.round(gap / 3)}px">Trading Intelligence</div>
      ${tagline ? `<div class="tagline" style="font-size:${tagline.size}px;margin-top:${tagline.mt}px">${tagline.text}</div>` : ""}
    </div>
  </div>
</body></html>`;
}

mkdirSync(dir, { recursive: true });

// Small promo tile 440x280 (REQUIRED by the store).
writeFileSync(
  resolve(dir, "tile-small.html"),
  page({ w: 440, h: 280, logo: 76, name: 44, caption: 11, pad: 30, gap: 16, tagline: null })
);

// Marquee 1400x560 (optional, required for featuring).
writeFileSync(
  resolve(dir, "tile-marquee.html"),
  page({
    w: 1400, h: 560, logo: 150, name: 92, caption: 20, pad: 72, gap: 30,
    tagline: { size: 30, mt: 18, text: "AI chart copilot for TradingView" },
  })
);

console.log("tile HTML generated in", dir);
