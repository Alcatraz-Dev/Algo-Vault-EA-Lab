import raw from "../styles/tokens.css?inline";

function extract(root: string): string {
  const start = raw.indexOf(root + " {");
  if (start === -1) return "";
  let depth = 1;
  let i = start + root.length + 2;
  while (i < raw.length && depth > 0) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}") depth--;
    i++;
  }
  return raw.slice(start + root.length + 2, i - 1);
}

const light = extract(":root");
const dark = extract(".dark");

export const shadowTokenCSS = `
:host { ${light} }
:host([data-theme="dark"]) { ${dark} }
`;
