/**
 * Inlines the built harness (dist/index.html + assets) into a single
 * self-contained `preview.html` so the local preview can serve it without a
 * module/CORS handshake.
 *
 * Uses replacer *functions* — a string replacement would let `$&` / `` $` ``
 * sequences inside minified JS corrupt the output.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "dist");
const assets = path.join(dist, "assets");

let html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
const files = fs.readdirSync(assets);
const jsFile = files.find((f) => f.endsWith(".js"));
const cssFile = files.find((f) => f.endsWith(".css"));
if (!jsFile || !cssFile) {
  console.error("harness build assets missing — run vite build first");
  process.exit(1);
}

let js = fs.readFileSync(path.join(assets, jsFile), "utf8");
// A literal `</script>` inside the inlined module would terminate the tag
// early; `<\/script>` inside a JS string is equivalent and safe.
js = js.replace(/<\/script/gi, "<\\/script");
const css = fs.readFileSync(path.join(assets, cssFile), "utf8");

html = html.replace(
  /<script[^>]*src="[^"]*"[^>]*><\/script>/,
  () => `<script type="module">${js}</script>`
);
html = html.replace(/<link[^>]*href="[^"]*"[^>]*>/, () => `<style>${css}</style>`);

const out = path.join(here, "preview.html");
fs.writeFileSync(out, html);

// Sanity check: exactly one script open + one close.
const opens = (html.match(/<script type="module">/g) || []).length;
const closes = (html.match(/<\/script>/g) || []).length;
console.log(`written ${out} (${html.length} bytes) — script opens=${opens} closes=${closes}`);
if (opens !== 1 || closes !== 1) {
  console.error("inline produced an unbalanced script tag set");
  process.exit(1);
}
