export type TokenType =
  | "NUMBER"
  | "STRING"
  | "IDENT"
  | "DOT"
  | "COMMA"
  | "COLON"
  | "SEMICOLON"
  | "LPAREN"
  | "RPAREN"
  | "LBRACKET"
  | "RBRACKET"
  | "LBRACE"
  | "RBRACE"
  | "ASSIGN"
  | "EQ"
  | "NEQ"
  | "LT"
  | "GT"
  | "LTE"
  | "GTE"
  | "PLUS"
  | "MINUS"
  | "STAR"
  | "SLASH"
  | "PERCENT"
  | "POWER"
  | "AND"
  | "OR"
  | "NOT"
  | "NEWLINE"
  | "EOF"
  | "AT"
  | "HASH";

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

const KEYWORDS = new Set([
  "if", "else", "for", "while", "return", "true", "false", "na",
  "and", "or", "not", "type", "var", "varip", "as", "import",
  "export", "extend",
]);

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  function peek(offset = 0): string {
    return source[i + offset] ?? "";
  }

  function advance(): string {
    const ch = source[i++];
    if (ch === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  }

  function addToken(type: TokenType, value: string, startLine: number, startCol: number) {
    tokens.push({ type, value, line: startLine, column: startCol });
  }

  while (i < source.length) {
    const ch = peek();
    const startLine = line;
    const startCol = col;

    if (ch === "\n") {
      advance();
      // Collapse multiple newlines, but emit one NEWLINE token
      if (tokens.length > 0 && tokens[tokens.length - 1].type !== "NEWLINE") {
        addToken("NEWLINE", "\n", startLine, startCol);
      }
      continue;
    }

    if (ch === " " || ch === "\t" || ch === "\r") {
      advance();
      continue;
    }

    if (ch === "#") {
      advance();
      if (peek() === "!") {
        // Version directive: //@version=6
        let directive = "";
        while (i < source.length && peek() !== "\n") {
          directive += advance();
        }
        addToken("HASH", directive, startLine, startCol);
        continue;
      }
      // Comment
      while (i < source.length && peek() !== "\n") advance();
      continue;
    }

    if (ch === "/" && peek(1) === "/") {
      while (i < source.length && peek() !== "\n") advance();
      continue;
    }

    if (ch === "/" && peek(1) === "*") {
      advance(); advance();
      while (i < source.length && !(peek() === "*" && peek(1) === "/")) advance();
      if (peek() === "*" && peek(1) === "/") { advance(); advance(); }
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = advance();
      let str = "";
      while (i < source.length && peek() !== quote) {
        if (peek() === "\\") { advance(); str += advance(); }
        else str += advance();
      }
      if (i < source.length) advance(); // closing quote
      addToken("STRING", str, startLine, startCol);
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(peek(1)))) {
      let num = "";
      if (ch === "0" && (peek(1) === "x" || peek(1) === "X")) {
        num += advance(); num += advance();
        while (i < source.length && /[0-9a-fA-F]/.test(peek())) num += advance();
      } else {
        while (i < source.length && /[0-9]/.test(peek())) num += advance();
        if (peek() === "." && /[0-9]/.test(peek(1))) {
          num += advance();
          while (i < source.length && /[0-9]/.test(peek())) num += advance();
        }
        if (peek() === "e" || peek() === "E") {
          num += advance();
          if (peek() === "+" || peek() === "-") num += advance();
          while (i < source.length && /[0-9]/.test(peek())) num += advance();
        }
      }
      addToken("NUMBER", num, startLine, startCol);
      continue;
    }

    if (/[a-zA-Z_]/.test(ch)) {
      let ident = "";
      while (i < source.length && /[a-zA-Z0-9_]/.test(peek())) ident += advance();
      const upper = ident.toUpperCase();
      if (upper === "AND") addToken("AND", ident, startLine, startCol);
      else if (upper === "OR") addToken("OR", ident, startLine, startCol);
      else if (upper === "NOT") addToken("NOT", ident, startLine, startCol);
      else if (KEYWORDS.has(ident.toLowerCase())) addToken("IDENT", ident, startLine, startCol);
      else addToken("IDENT", ident, startLine, startCol);
      continue;
    }

    if (ch === "@") { advance(); addToken("AT", "@", startLine, startCol); continue; }

    // Two-char operators
    const next = peek(1);
    if (ch === "=" && next === "=") { advance(); advance(); addToken("EQ", "==", startLine, startCol); continue; }
    if (ch === "!" && next === "=") { advance(); advance(); addToken("NEQ", "!=", startLine, startCol); continue; }
    if (ch === "<" && next === "=") { advance(); advance(); addToken("LTE", "<=", startLine, startCol); continue; }
    if (ch === ">" && next === "=") { advance(); advance(); addToken("GTE", ">=", startLine, startCol); continue; }

    // Single-char operators
    const singleMap: Record<string, TokenType> = {
      ".": "DOT", ",": "COMMA", ":": "COLON", ";": "SEMICOLON",
      "(": "LPAREN", ")": "RPAREN", "[": "LBRACKET", "]": "RBRACKET",
      "{": "LBRACE", "}": "RBRACE",
      "=": "ASSIGN", "<": "LT", ">": "GT",
      "+": "PLUS", "-": "MINUS", "*": "STAR", "/": "SLASH",
      "%": "PERCENT", "^": "POWER",
    };
    if (singleMap[ch]) {
      advance();
      addToken(singleMap[ch], ch, startLine, startCol);
      continue;
    }

    advance(); // skip unknown
  }

  addToken("EOF", "", line, col);
  return tokens;
}
