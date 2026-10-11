import postcss from "postcss"
import tw from "@tailwindcss/postcss"
import { readFileSync, writeFileSync } from "node:fs"

const css = readFileSync("app/globals.css", "utf8")
const res = await postcss([tw()]).process(css, { from: "app/globals.css" })
writeFileSync(".twcheck.out.css", res.css)
console.log("bytes:", res.css.length)
