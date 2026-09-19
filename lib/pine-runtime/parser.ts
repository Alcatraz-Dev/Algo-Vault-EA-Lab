import { tokenize, Token, TokenType } from "./lexer";
import type {
  Program, Statement, Expression, Block, ScriptMetadata,
  VariableDeclaration, Reassignment, IfStatement, ForLoop, WhileLoop,
  FunctionCall, MethodCall, BinaryExpression, UnaryExpression,
  LogicalExpression, TernaryExpression, FieldAccess, IndexAccess,
  Identifier, NumberLiteral, StringLiteral, BoolLiteral, ColorLiteral,
  NaLiteral, ArrayLiteral, TupleExpression, ReturnStatement, TypeDeclaration,
} from "./ast";

class ParseError extends Error {
  constructor(message: string, public token: Token) {
    super(`Line ${token.line}:${token.column} — ${message}`);
  }
}

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private advance(): Token {
    const token = this.tokens[this.pos];
    if (token.type !== "EOF") this.pos++;
    return token;
  }

  private expect(type: TokenType): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw new ParseError(`Expected ${type}, got ${token.type} ("${token.value}")`, token);
    }
    return this.advance();
  }

  private skipNewlines(): void {
    while (this.peek().type === "NEWLINE") this.advance();
  }

  private skipNewlinesAndSemicolons(): void {
    while (this.peek().type === "NEWLINE" || this.peek().type === "SEMICOLON") this.advance();
  }

  private match(type: TokenType): boolean {
    if (this.peek().type === type) { this.advance(); return true; }
    return false;
  }

  parse(): Program {
    const metadata: ScriptMetadata = {
      isIndicator: false,
      isStrategy: false,
      title: "",
      overlay: false,
      format: "price",
    };

    let version = "5";
    if (this.peek().type === "HASH") {
      const dir = this.advance().value;
      const match = dir.match(/@version=(\d+)/);
      if (match) version = match[1];
    }
    this.skipNewlines();

    const body: Statement[] = [];
    while (this.peek().type !== "EOF") {
      this.skipNewlinesAndSemicolons();
      if (this.peek().type === "EOF") break;

      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      this.skipNewlinesAndSemicolons();
    }

    // Extract metadata from function calls
    for (const stmt of body) {
      if (stmt.type === "FunctionCall" && !stmt.namespace) {
        const name = stmt.name.toLowerCase();
        if (name === "indicator" || name === "strategy") {
          metadata.isIndicator = name === "indicator";
          metadata.isStrategy = name === "strategy";
          const titleArg = stmt.args.find(a => a.value.type === "StringLiteral");
          if (titleArg) metadata.title = (titleArg.value as StringLiteral).value;
          for (const arg of stmt.args) {
            if (arg.name) {
              const key = arg.name.toLowerCase();
              if (arg.value.type === "BoolLiteral") {
                if (key === "overlay") metadata.overlay = (arg.value as BoolLiteral).value;
                if (key === "calc_on_order_fills") metadata.calcOnOrderFills = (arg.value as BoolLiteral).value;
                if (key === "calc_on_every_tick") metadata.calcOnEveryTick = (arg.value as BoolLiteral).value;
              }
              if (arg.value.type === "NumberLiteral") {
                if (key === "pyramiding") metadata.pyramiding = (arg.value as NumberLiteral).value;
                if (key === "max_bars_back") metadata.maxBarsBack = (arg.value as NumberLiteral).value;
                if (key === "max_labels_count") metadata.maxLabelsCount = (arg.value as NumberLiteral).value;
                if (key === "max_lines_count") metadata.maxLinesCount = (arg.value as NumberLiteral).value;
                if (key === "max_boxes_count") metadata.maxBoxesCount = (arg.value as NumberLiteral).value;
              }
              if (arg.value.type === "StringLiteral") {
                if (key === "format") metadata.format = (arg.value as StringLiteral).value;
                if (key === "shorttitle" || key === "short_title") metadata.shortTitle = (arg.value as StringLiteral).value;
                if (key === "timeframe") metadata.timeFrame = (arg.value as StringLiteral).value;
              }
            }
          }
        }
      }
    }

    return { type: "Program", version, body, metadata };
  }

  private parseStatement(): Statement | null {
    this.skipNewlinesAndSemicolons();
    const token = this.peek();

    if (token.type === "EOF") return null;

    if (token.type === "IDENT") {
      const lower = token.value.toLowerCase();
      if (lower === "if") return this.parseIf();
      if (lower === "for") return this.parseFor();
      if (lower === "while") return this.parseWhile();
      if (lower === "return") return this.parseReturn();
      if (lower === "type") return this.parseTypeDecl();
      if (lower === "var" || lower === "varip") return this.parseVarDecl();
    }

    // Check for type annotation: name = expression
    if (token.type === "IDENT" && this.peek(1).type === "IDENT") {
      // Could be "float x = ..." or just "x = ..."
      return this.parseVarDecl();
    }

    return this.parseExpressionStatement();
  }

  private parseVarDecl(): Statement {
    const startToken = this.peek();
    let typeName: string | undefined;

    // Check if current token is a type name
    if (this.peek().type === "IDENT" && this.peek(1).type === "IDENT") {
      typeName = this.advance().value;
    }

    if (this.peek().type === "IDENT" && (this.peek(1).type === "ASSIGN" || this.peek(1).type === "EQ")) {
      const name = this.advance().value;
      this.advance(); // = or :=
      const value = this.parseExpression();
      return { type: "VariableDeclaration", name, typeName, value, loc: startToken ? { line: startToken.line, column: startToken.column } : undefined };
    }

    return this.parseExpressionStatement();
  }

  private parseIf(): IfStatement {
    const startToken = this.peek();
    this.advance(); // if
    const condition = this.parseExpression();
    this.skipNewlines();
    const consequent = this.parseBlockOrStatement();
    let alternate: Statement | Block | IfStatement | undefined;
    this.skipNewlinesAndSemicolons();
    if (this.peek().type === "IDENT" && this.peek().value.toLowerCase() === "else") {
      this.advance();
      this.skipNewlines();
      if (this.peek().type === "IDENT" && this.peek().value.toLowerCase() === "if") {
        alternate = this.parseIf();
      } else {
        alternate = this.parseBlockOrStatement();
      }
    }
    return { type: "IfStatement", condition, consequent, alternate, loc: { line: startToken.line, column: startToken.column } };
  }

  private parseBlockOrStatement(): Block | Statement {
    if (this.peek().type === "LBRACE") return this.parseBlock();
    this.skipNewlines();
    if (this.peek().type === "LBRACE") return this.parseBlock();
    const stmt = this.parseStatement();
    return stmt || { type: "Block", body: [] };
  }

  private parseBlock(): Block {
    const startToken = this.peek();
    this.expect("LBRACE");
    this.skipNewlines();
    const body: Statement[] = [];
    while (this.peek().type !== "RBRACE" && this.peek().type !== "EOF") {
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      this.skipNewlinesAndSemicolons();
    }
    this.expect("RBRACE");
    return { type: "Block", body, loc: { line: startToken.line, column: startToken.column } };
  }

  private parseFor(): ForLoop {
    const startToken = this.peek();
    this.advance(); // for
    const variable = this.expect("IDENT").value;
    this.expect("ASSIGN");
    const from = this.parseExpression();
    this.expect("IDENT"); // "to"
    const to = this.parseExpression();
    this.skipNewlines();
    const body = this.parseBlock();
    return { type: "ForLoop", variable, from, to, body, loc: { line: startToken.line, column: startToken.column } };
  }

  private parseWhile(): WhileLoop {
    const startToken = this.peek();
    this.advance(); // while
    this.expect("LPAREN");
    const condition = this.parseExpression();
    this.expect("RPAREN");
    this.skipNewlines();
    const body = this.parseBlock();
    return { type: "WhileLoop", condition, body, loc: { line: startToken.line, column: startToken.column } };
  }

  private parseReturn(): ReturnStatement {
    const startToken = this.peek();
    this.advance(); // return
    let value: Expression | undefined;
    if (this.peek().type !== "NEWLINE" && this.peek().type !== "EOF" && this.peek().type !== "SEMICOLON") {
      value = this.parseExpression();
    }
    return { type: "ReturnStatement", value, loc: { line: startToken.line, column: startToken.column } };
  }

  private parseTypeDecl(): TypeDeclaration {
    const startToken = this.peek();
    this.advance(); // type
    const name = this.expect("IDENT").value;
    this.skipNewlines();
    this.expect("LBRACE");
    this.skipNewlines();
    const fields: TypeDeclaration["fields"] = [];
    while (this.peek().type !== "RBRACE" && this.peek().type !== "EOF") {
      const typeName = this.expect("IDENT").value;
      const fieldName = this.expect("IDENT").value;
      let defaultValue: Expression | undefined;
      if (this.peek().type === "ASSIGN" || this.peek().type === "EQ") {
        this.advance();
        defaultValue = this.parseExpression();
      }
      fields.push({ name: fieldName, typeName, defaultValue });
      this.skipNewlinesAndSemicolons();
    }
    this.expect("RBRACE");
    return { type: "TypeDeclaration", name, fields, loc: { line: startToken.line, column: startToken.column } };
  }

  private parseExpressionStatement(): Statement {
    const expr = this.parseExpression();

    if (expr.type === "Identifier" || expr.type === "FieldAccess" || expr.type === "IndexAccess") {
      if (this.peek().type === "ASSIGN" || this.peek().type === "EQ") {
        const eqToken = this.peek();
        this.advance();
        const value = this.parseExpression();
        return { type: "Reassignment", target: expr, value, loc: { line: eqToken.line, column: eqToken.column } };
      }
    }

    return expr as unknown as Statement;
  }

  private parseExpression(): Expression {
    return this.parseTernary();
  }

  private parseTernary(): Expression {
    const expr = this.parseOr();
    if (this.peek().type === "IDENT" && this.peek().value === "?") {
      this.advance();
      const consequent = this.parseExpression();
      this.expect("COLON");
      const alternate = this.parseExpression();
      return { type: "TernaryExpression", condition: expr, consequent, alternate };
    }
    return expr;
  }

  private parseOr(): Expression {
    let left = this.parseAnd();
    while (this.peek().type === "OR" || (this.peek().type === "IDENT" && this.peek().value.toLowerCase() === "or")) {
      this.advance();
      const right = this.parseAnd();
      left = { type: "LogicalExpression", operator: "or", left, right };
    }
    return left;
  }

  private parseAnd(): Expression {
    let left = this.parseComparison();
    while (this.peek().type === "AND" || (this.peek().type === "IDENT" && this.peek().value.toLowerCase() === "and")) {
      this.advance();
      const right = this.parseComparison();
      left = { type: "LogicalExpression", operator: "and", left, right };
    }
    return left;
  }

  private parseComparison(): Expression {
    let left = this.parseAddSub();
    while (
      this.peek().type === "EQ" || this.peek().type === "NEQ" ||
      this.peek().type === "LT" || this.peek().type === "GT" ||
      this.peek().type === "LTE" || this.peek().type === "GTE"
    ) {
      const op = this.advance().value;
      const right = this.parseAddSub();
      left = { type: "BinaryExpression", operator: op, left, right };
    }
    return left;
  }

  private parseAddSub(): Expression {
    let left = this.parseMulDiv();
    while (this.peek().type === "PLUS" || this.peek().type === "MINUS") {
      const op = this.advance().value;
      const right = this.parseMulDiv();
      left = { type: "BinaryExpression", operator: op, left, right };
    }
    return left;
  }

  private parseMulDiv(): Expression {
    let left = this.parsePower();
    while (this.peek().type === "STAR" || this.peek().type === "SLASH" || this.peek().type === "PERCENT") {
      const op = this.advance().value;
      const right = this.parsePower();
      left = { type: "BinaryExpression", operator: op, left, right };
    }
    return left;
  }

  private parsePower(): Expression {
    let left = this.parseUnary();
    if (this.peek().type === "POWER") {
      this.advance();
      const right = this.parseUnary();
      left = { type: "BinaryExpression", operator: "^", left, right };
    }
    return left;
  }

  private parseUnary(): Expression {
    if (this.peek().type === "MINUS") {
      const op = this.advance().value;
      const operand = this.parseUnary();
      return { type: "UnaryExpression", operator: op, operand };
    }
    if (this.peek().type === "NOT" || (this.peek().type === "IDENT" && this.peek().value.toLowerCase() === "not")) {
      this.advance();
      const operand = this.parseUnary();
      return { type: "UnaryExpression", operator: "not", operand };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expression {
    let expr = this.parsePrimary();

    while (true) {
      if (this.peek().type === "DOT") {
        this.advance();
        const field = this.peek().type === "IDENT" ? this.advance().value : this.expect("IDENT").value;
        // Check if it's a method call (followed by '(')
        if (this.peek().type === "LPAREN") {
          this.advance();
          const args = this.parseArguments();
          this.expect("RPAREN");
          expr = { type: "MethodCall", object: expr, method: field, args };
        } else {
          expr = { type: "FieldAccess", object: expr, field };
        }
      } else if (this.peek().type === "LBRACKET") {
        this.advance();
        const index = this.parseExpression();
        this.expect("RBRACKET");
        expr = { type: "IndexAccess", object: expr, index };
      } else {
        break;
      }
    }

    return expr;
  }

  private parsePrimary(): Expression {
    const token = this.peek();

    if (token.type === "NUMBER") {
      this.advance();
      const value = token.value.includes(".") || token.value.toLowerCase().includes("e")
        ? parseFloat(token.value)
        : parseInt(token.value, token.value.startsWith("0x") ? 16 : 10);
      return { type: "NumberLiteral", value, loc: { line: token.line, column: token.column } };
    }

    if (token.type === "STRING") {
      this.advance();
      return { type: "StringLiteral", value: token.value, loc: { line: token.line, column: token.column } };
    }

    if (token.type === "IDENT") {
      const lower = token.value.toLowerCase();
      if (lower === "true" || lower === "false") {
        this.advance();
        return { type: "BoolLiteral", value: lower === "true", loc: { line: token.line, column: token.column } };
      }
      if (lower === "na") {
        this.advance();
        return { type: "NaLiteral", loc: { line: token.line, column: token.column } };
      }
    }

    if (token.type === "IDENT") {
      this.advance();
      // Check for namespace: e.g., ta.sma
      if (this.peek().type === "DOT" && this.peek(1).type === "IDENT") {
        this.advance(); // dot
        const method = this.advance().value;
        if (this.peek().type === "LPAREN") {
          this.advance();
          const args = this.parseArguments();
          this.expect("RPAREN");
          return { type: "FunctionCall", namespace: token.value, name: method, args, loc: { line: token.line, column: token.column } };
        }
        return { type: "FieldAccess", object: { type: "Identifier", name: token.value }, field: method };
      }
      // Check for function call
      if (this.peek().type === "LPAREN") {
        this.advance();
        const args = this.parseArguments();
        this.expect("RPAREN");
        return { type: "FunctionCall", name: token.value, args, loc: { line: token.line, column: token.column } };
      }
      return { type: "Identifier", name: token.value, loc: { line: token.line, column: token.column } };
    }

    if (token.type === "LPAREN") {
      this.advance();
      const elements: Expression[] = [];
      if (this.peek().type !== "RPAREN") {
        elements.push(this.parseExpression());
        while (this.peek().type === "COMMA") {
          this.advance();
          elements.push(this.parseExpression());
        }
      }
      this.expect("RPAREN");
      if (elements.length === 1) return elements[0];
      return { type: "TupleExpression", elements };
    }

    if (token.type === "LBRACKET") {
      this.advance();
      const elements: Expression[] = [];
      if (this.peek().type !== "RBRACKET") {
        elements.push(this.parseExpression());
        while (this.peek().type === "COMMA") {
          this.advance();
          if (this.peek().type === "RBRACKET") break;
          elements.push(this.parseExpression());
        }
      }
      this.expect("RBRACKET");
      return { type: "ArrayLiteral", elements };
    }

    throw new ParseError(`Unexpected token: ${token.type} ("${token.value}")`, token);
  }

  private parseArguments(): { name?: string; value: Expression }[] {
    const args: { name?: string; value: Expression }[] = [];
    if (this.peek().type === "RPAREN") return args;

    args.push(this.parseArgument());
    while (this.peek().type === "COMMA") {
      this.advance();
      if (this.peek().type === "RPAREN") break;
      args.push(this.parseArgument());
    }
    return args;
  }

  private parseArgument(): { name?: string; value: Expression } {
    // Check for named argument: name = expr
    if (this.peek().type === "IDENT" && this.peek(1).type === "ASSIGN") {
      const name = this.advance().value;
      this.advance(); // =
      return { name, value: this.parseExpression() };
    }
    return { value: this.parseExpression() };
  }
}

export function parse(source: string): Program {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  return parser.parse();
}
