export type NodeType =
  | "Program"
  | "VersionDirective"
  | "FunctionCall"
  | "MethodCall"
  | "BinaryExpression"
  | "UnaryExpression"
  | "LogicalExpression"
  | "TernaryExpression"
  | "Assignment"
  | "Reassignment"
  | "VariableDeclaration"
  | "Block"
  | "IfStatement"
  | "ForLoop"
  | "WhileLoop"
  | "TypeDeclaration"
  | "FieldAccess"
  | "IndexAccess"
  | "Identifier"
  | "NumberLiteral"
  | "StringLiteral"
  | "BoolLiteral"
  | "ColorLiteral"
  | "NaLiteral"
  | "ArrayLiteral"
  | "TupleExpression"
  | "ReturnStatement"
  | "Comment";

export interface SourceLocation {
  line: number;
  column: number;
}

export interface BaseNode {
  type: NodeType;
  loc?: SourceLocation;
}

export interface Program extends BaseNode {
  type: "Program";
  version: string;
  body: Statement[];
  metadata: ScriptMetadata;
}

export interface ScriptMetadata {
  isIndicator: boolean;
  isStrategy: boolean;
  title: string;
  overlay: boolean;
  format: string;
  shortTitle?: string;
  formatOutput?: string;
  timeFrame?: string;
  pyramiding?: number;
  calcOnOrderFills?: boolean;
  calcOnEveryTick?: boolean;
  maxBarsBack?: number;
  maxLabelsCount?: number;
  maxLinesCount?: number;
  maxBoxesCount?: number;
}

export type Statement =
  | VariableDeclaration
  | Reassignment
  | IfStatement
  | ForLoop
  | WhileLoop
  | FunctionCall
  | MethodCall
  | ReturnStatement
  | Block
  | TypeDeclaration;

export interface VariableDeclaration extends BaseNode {
  type: "VariableDeclaration";
  name: string;
  typeName?: string;
  value: Expression;
  isConstant?: boolean;
}

export interface Reassignment extends BaseNode {
  type: "Reassignment";
  target: Expression;
  value: Expression;
}

export interface IfStatement extends BaseNode {
  type: "IfStatement";
  condition: Expression;
  consequent: Block | Statement;
  alternate?: Block | Statement | IfStatement;
}

export interface ForLoop extends BaseNode {
  type: "ForLoop";
  variable: string;
  from: Expression;
  to: Expression;
  body: Block;
}

export interface WhileLoop extends BaseNode {
  type: "WhileLoop";
  condition: Expression;
  body: Block;
}

export interface Block extends BaseNode {
  type: "Block";
  body: Statement[];
}

export interface ReturnStatement extends BaseNode {
  type: "ReturnStatement";
  value?: Expression;
}

export interface TypeDeclaration extends BaseNode {
  type: "TypeDeclaration";
  name: string;
  fields: { name: string; typeName: string; defaultValue?: Expression }[];
}

export type Expression =
  | FunctionCall
  | MethodCall
  | BinaryExpression
  | UnaryExpression
  | LogicalExpression
  | TernaryExpression
  | FieldAccess
  | IndexAccess
  | Identifier
  | NumberLiteral
  | StringLiteral
  | BoolLiteral
  | ColorLiteral
  | NaLiteral
  | ArrayLiteral
  | TupleExpression;

export interface FunctionCall extends BaseNode {
  type: "FunctionCall";
  namespace?: string;
  name: string;
  args: { name?: string; value: Expression }[];
}

export interface MethodCall extends BaseNode {
  type: "MethodCall";
  object: Expression;
  method: string;
  args: { name?: string; value: Expression }[];
}

export interface BinaryExpression extends BaseNode {
  type: "BinaryExpression";
  operator: string;
  left: Expression;
  right: Expression;
}

export interface UnaryExpression extends BaseNode {
  type: "UnaryExpression";
  operator: string;
  operand: Expression;
}

export interface LogicalExpression extends BaseNode {
  type: "LogicalExpression";
  operator: "and" | "or";
  left: Expression;
  right: Expression;
}

export interface TernaryExpression extends BaseNode {
  type: "TernaryExpression";
  condition: Expression;
  consequent: Expression;
  alternate: Expression;
}

export interface FieldAccess extends BaseNode {
  type: "FieldAccess";
  object: Expression;
  field: string;
}

export interface IndexAccess extends BaseNode {
  type: "IndexAccess";
  object: Expression;
  index: Expression;
}

export interface Identifier extends BaseNode {
  type: "Identifier";
  name: string;
}

export interface NumberLiteral extends BaseNode {
  type: "NumberLiteral";
  value: number;
}

export interface StringLiteral extends BaseNode {
  type: "StringLiteral";
  value: string;
}

export interface BoolLiteral extends BaseNode {
  type: "BoolLiteral";
  value: boolean;
}

export interface ColorLiteral extends BaseNode {
  type: "ColorLiteral";
  value: string;
}

export interface NaLiteral extends BaseNode {
  type: "NaLiteral";
}

export interface ArrayLiteral extends BaseNode {
  type: "ArrayLiteral";
  elements: Expression[];
}

export interface TupleExpression extends BaseNode {
  type: "TupleExpression";
  elements: Expression[];
}
