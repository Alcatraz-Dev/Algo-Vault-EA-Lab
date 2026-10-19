import raw from "../styles/tokens.css?inline";

function extract(selector: string): string {
  const s = raw.indexOf(selector + " {");
  if (s === -1) return "";
  let d = 1, i = s + selector.length + 2;
  while (i < raw.length && d > 0) { if (raw[i] === "{") d++; else if (raw[i] === "}") d--; i++; }
  return raw.slice(s + selector.length + 2, i - 1);
}

export const shadowTokenCSS = `
.av-tokens { ${extract(":root")} }
.av-tokens[data-theme="dark"] { ${extract(".dark")} }
`;